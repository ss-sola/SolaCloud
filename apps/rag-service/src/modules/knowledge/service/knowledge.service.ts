import { BaseService, getConfig, ProjectException } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, In, Repository } from 'typeorm';
import { RagConfigKeys } from '../../../config-keys';
import { FileServiceClient } from '../../../client/file-service.client';
import { FileDownloadUtil } from '../../../utils/file-download.util';
import { RagConfigService } from '../../config/service/rag-config.service';
import { PROCESSING_STATUS } from '../knowledge.constants';
import { DocumentChunk } from '../entity/document-chunk.entity';
import { KnowledgeBase } from '../entity/knowledge-base.entity';
import { KnowledgeDocument } from '../entity/knowledge-document.entity';
import { EmbeddingService } from './embedding.service';
import { DocumentChunkService } from './document-chunk.service';
import { DocumentVectorizationService, ResolvedAttachment } from './document-vectorization.service';

/** 附件对象入参 */
export interface AttachmentInput {
  fileId?: number;
  fileName?: string;
  mimeType?: string;
  filePath?: string;
  fileUrl?: string;
}

/**
 * 知识库业务编排服务。
 * 负责知识库 CRUD、附件解析、向量化调度。
 * 向量化管道逻辑委托给 DocumentVectorizationService。
 */
@Injectable()
export class KnowledgeService extends BaseService<KnowledgeDocument> {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly knowledgeBaseRepo: Repository<KnowledgeBase>;
  private readonly chunkRepo: Repository<DocumentChunk>;

  constructor(
    @InjectRepository(KnowledgeDocument)
    documentRepo: Repository<KnowledgeDocument>,
    private readonly dataSource: DataSource,
    private readonly embeddingService: EmbeddingService,
    private readonly fileServiceClient: FileServiceClient,
    private readonly ragConfigService: RagConfigService,
    private readonly documentChunkService: DocumentChunkService,
    private readonly vectorizationService: DocumentVectorizationService,
  ) {
    super(documentRepo);
    this.knowledgeBaseRepo = this.dataSource.getRepository(KnowledgeBase);
    this.chunkRepo = this.dataSource.getRepository(DocumentChunk);
  }

  /** 创建知识库 */
  async createKnowledgeBase(options: {
    name: string;
    description?: string;
    createUser?: number;
  }): Promise<KnowledgeBase> {
    const kb = this.knowledgeBaseRepo.create({
      name: options.name,
      description: options.description ?? null,
      embeddingModel: await this.embeddingService.getModelName(),
      embeddingDimension: await this.embeddingService.getDimension(),
      createUser: options.createUser ?? undefined,
      updateUser: options.createUser ?? undefined,
    });
    return this.knowledgeBaseRepo.save(kb);
  }

  /** 接收附件数组，启动向量化处理 */
  async ingestAttachments(options: {
    knowledgeBaseId: number;
    attachments: AttachmentInput[];
    createUser?: number;
  }): Promise<KnowledgeDocument[]> {
    const kb = await this.knowledgeBaseRepo.findOneBy({ id: options.knowledgeBaseId });
    if (!kb) {
      throw new ProjectException('知识库不存在');
    }

    const resolvedAttachments = await Promise.all(
      options.attachments.map((attachment) => this.resolveAttachment(attachment)),
    );

    // 提前获取向量化配置，避免每个文档重复获取
    const embedConfig = await this.ragConfigService.getEmbeddingConfig();

    const documents: KnowledgeDocument[] = [];
    // 记录需要异步处理的 (document, attachment) 对
    const pendingPairs: { doc: KnowledgeDocument; attachment: ResolvedAttachment }[] = [];

    for (const attachment of resolvedAttachments) {
      // 幂等性检查：同一 fileId + knowledgeBaseId 已有 completed 文档时跳过
      if (attachment.fileId) {
        const existing = await this.repository.findOne({
          where: {
            fileId: attachment.fileId,
            knowledgeBaseId: options.knowledgeBaseId,
            processingStatus: PROCESSING_STATUS.Completed,
          } as any,
        });
        if (existing) {
          this.logger.log(
            `跳过重复向量化: fileId=${attachment.fileId}, knowledgeBaseId=${options.knowledgeBaseId}`,
          );
          documents.push(existing);
          continue;
        }
      }

      const doc = await this.create({
        knowledgeBaseId: options.knowledgeBaseId,
        fileId: attachment.fileId,
        processingStatus: PROCESSING_STATUS.Pending,
        createUser: options.createUser ?? undefined,
        updateUser: options.createUser ?? undefined,
      });
      documents.push(doc);
      pendingPairs.push({ doc, attachment });
    }

    // 异步处理新文档（不阻塞 HTTP 响应），传入已获取的配置
    for (const { doc, attachment } of pendingPairs) {
      void this.vectorizationService.vectorize(doc, attachment, { embedConfig });
    }

    return documents;
  }

  /** 查询文档处理状态 */
  async getDocumentStatus(documentId: number): Promise<KnowledgeDocument | null> {
    return this.findOne(documentId);
  }

  /** 根据 fileId 删除知识库文档及其 chunk */
  async deleteByFileId(fileId: number): Promise<void> {
    const docs = await this.repository.find({
      where: { fileId } as any,
    });
    if (docs.length === 0) {
      return;
    }

    const docIds = docs.map((doc) => doc.id);

    // 删除关联的 chunk
    await this.chunkRepo
      .createQueryBuilder()
      .delete()
      .where('document_id IN (:...ids)', { ids: docIds })
      .execute();

    // 软删除文档
    await this.repository.update(
      { id: In(docIds) },
      { processingStatus: PROCESSING_STATUS.Failed as any },
    );

    this.logger.log(`已删除 fileId=${fileId} 关联的 ${docs.length} 个文档及其分片`);
  }

  /**
   * 自动向量化入口（文件上传后描述生成完成触发）。
   * 不依赖知识库，文件下载到临时目录后处理。
   */
  async processAttachmentForVectorization(options: {
    fileId: number;
    fileUrl: string;
    mimeType: string;
    fileName: string;
    description: string;
  }): Promise<void> {
    const { fileId, fileUrl, mimeType, fileName, description } = options;

    // 幂等性检查：同一 fileId 已有 completed 的临时文档时跳过
    const existing = await this.repository.findOne({
      where: {
        fileId,
        knowledgeBaseId: 0,
        processingStatus: PROCESSING_STATUS.Completed,
      } as any,
    });
    if (existing) {
      this.logger.log(`跳过重复自动向量化: fileId=${fileId}`);
      return;
    }

    const tmpDir = this.vectorizationService.getTempDir();
    const ext = path.extname(fileName) || '.tmp';
    const tmpPath = path.join(tmpDir, `${fileId}-${Date.now()}${ext}`);

    try {
      // 1. 下载文件到临时目录
      await FileDownloadUtil.downloadToFile(fileUrl, tmpPath);

      // 2. 创建文档记录
      const doc = await this.create({
        fileId,
        knowledgeBaseId: 0, // 临时文档不关联知识库
        processingStatus: PROCESSING_STATUS.Pending,
      });

      const attachment: ResolvedAttachment = {
        fileId,
        fileName,
        mimeType,
        filePath: tmpPath,
        fileUrl: null,
      };

      // 提前获取配置，传入已有描述
      const embedConfig = await this.ragConfigService.getEmbeddingConfig();
      await this.vectorizationService.vectorize(doc, attachment, { description, embedConfig });
    } finally {
      // 3. 清理临时文件
      await fs.promises.unlink(tmpPath).catch(() => undefined);
    }
  }

  private async resolveAttachment(attachment: AttachmentInput): Promise<ResolvedAttachment> {
    if (attachment.fileId) {
      return this.resolveAttachmentByFileId(attachment.fileId);
    }

    if (!attachment.fileName || !attachment.mimeType || !attachment.filePath) {
      throw new ProjectException('附件缺少 fileId 或必要的文件信息');
    }

    return {
      fileId: null,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      filePath: attachment.filePath,
      fileUrl: attachment.fileUrl ?? null,
    };
  }

  private async resolveAttachmentByFileId(fileId: number): Promise<ResolvedAttachment> {
    const response = await this.fileServiceClient.getFileDetail({ id: fileId });
    const file = response.data;

    if (!file) {
      throw new ProjectException(`文件不存在: ${fileId}`);
    }

    const uploadRootDir = getConfig<string>(RagConfigKeys.UploadRootDir, 'public/uploads', false);
    const publicBaseUrl = getConfig<string>(RagConfigKeys.UploadPublicBaseUrl, '', false);
    const normalizedStoragePath = file.storagePath.replace(/\\/g, '/').replace(/^\/+/, '');

    return {
      fileId: file.id,
      fileName: file.originalName,
      mimeType: file.mimeType,
      filePath: path.resolve(uploadRootDir, normalizedStoragePath),
      fileUrl: publicBaseUrl
        ? `${publicBaseUrl.replace(/\/+$/, '')}/${normalizedStoragePath}`
        : null,
    };
  }
}
