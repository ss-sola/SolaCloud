import { getConfig } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { DataSource, Repository } from 'typeorm';
import { RagConfigKeys } from '../../../config-keys';
import { TextSplitterUtil, TextChunk } from '../../../utils/text-splitter.util';
import { FileServiceClient } from '../../../client/file-service.client';
import { RagConfigService } from '../../config/service/rag-config.service';
import type { EmbeddingConfig } from '../../config/service/rag-config.service';
import { FILE_TYPE_CATEGORY, MIME_TO_FILE_TYPE, PROCESSING_STATUS } from '../knowledge.constants';
import { DocumentChunk } from '../entity/document-chunk.entity';
import { KnowledgeDocument } from '../entity/knowledge-document.entity';
import { DocumentProcessorService } from './document-processor.service';
import { EmbeddingService } from './embedding.service';
import { MediaProcessorService } from './media-processor.service';

/** 已解析的附件信息 */
export interface ResolvedAttachment {
  fileId: number | null;
  fileName: string;
  mimeType: string;
  filePath: string;
  fileUrl: string | null;
}

/** vectorize 方法的选项 */
export interface VectorizeOptions {
  /** 已有描述则直接使用，否则从 FileService 获取 */
  description?: string;
  /** 已获取的向量化配置，避免重复获取 */
  embedConfig?: EmbeddingConfig;
}

/**
 * 文档向量化管道服务。
 * 职责：解析 → 分片 → 向量化 → 存储。
 * 从 KnowledgeService 提取，独立管理向量化管道的完整生命周期。
 */
@Injectable()
export class DocumentVectorizationService {
  private readonly logger = new Logger(DocumentVectorizationService.name);
  private readonly chunkRepo: Repository<DocumentChunk>;
  private readonly documentRepo: Repository<KnowledgeDocument>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly embeddingService: EmbeddingService,
    private readonly ragConfigService: RagConfigService,
    private readonly fileServiceClient: FileServiceClient,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly mediaProcessor: MediaProcessorService,
  ) {
    this.chunkRepo = this.dataSource.getRepository(DocumentChunk);
    this.documentRepo = this.dataSource.getRepository(KnowledgeDocument);
  }

  /**
   * 执行文档向量化管道：解析 → 分片 → 向量化 → 存储。
   * @param doc 已创建的文档记录
   * @param attachment 已解析的附件信息
   * @param options.description 已有描述则直接使用，否则从 FileService 获取
   * @param options.embedConfig 已获取的配置，避免重复从字典获取
   */
  async vectorize(
    doc: KnowledgeDocument,
    attachment: ResolvedAttachment,
    options?: VectorizeOptions,
  ): Promise<void> {
    try {
      await this.documentRepo.update(doc.id, {
        processingStatus: PROCESSING_STATUS.Processing,
      });

      // 1. 获取附件描述
      const attachmentDescription = await this.resolveDescription(attachment, options?.description);

      // 2. 解析文档内容（非文本文件只向量化描述）
      const fileType = MIME_TO_FILE_TYPE[attachment.mimeType] ?? FILE_TYPE_CATEGORY.Document;
      const isNonTextFile =
        fileType === FILE_TYPE_CATEGORY.Image ||
        fileType === FILE_TYPE_CATEGORY.Audio ||
        fileType === FILE_TYPE_CATEGORY.Video;

      let enrichedChunks: TextChunk[];

      if (isNonTextFile) {
        enrichedChunks = attachmentDescription
          ? [
              {
                content: attachmentDescription,
                metadata: { source: attachment.fileName, type: fileType },
              },
            ]
          : [];
      } else {
        const rawChunks = await this.extractContent(attachment);
        enrichedChunks = attachmentDescription
          ? rawChunks.map((chunk) => ({
              ...chunk,
              content: `[附件描述]\n${attachmentDescription}\n\n[正文]\n${chunk.content}`,
            }))
          : rawChunks;
      }

      // 3. 获取分片参数并执行文本分片
      const embedConfig =
        options?.embedConfig ?? (await this.ragConfigService.getEmbeddingConfig());
      const textChunks = enrichedChunks.flatMap((chunk) =>
        TextSplitterUtil.splitText(chunk.content, {
          chunkSize: embedConfig.chunkSize,
          chunkOverlap: embedConfig.chunkOverlap,
          metadata: chunk.metadata,
        }),
      );

      // 分片完成后立即更新 chunkCount，前端可提前展示分片总数
      await this.documentRepo.update(doc.id, { chunkCount: textChunks.length });

      if (textChunks.length === 0) {
        await this.documentRepo.update(doc.id, {
          processingStatus: PROCESSING_STATUS.Completed,
          processedChunks: 0,
        });
        return;
      }

      // 4. 批量向量化
      const texts = textChunks.map((c) => c.content);
      const embeddings = await this.embeddingService.embedTexts(texts);

      // 5. 存储分片
      const chunks = textChunks.map((chunk, idx) =>
        this.chunkRepo.create({
          documentId: doc.id,
          knowledgeBaseId: doc.knowledgeBaseId,
          chunkIndex: idx,
          content: chunk.content,
          metadata: chunk.metadata,
          embedding: embeddings[idx],
          tokenCount: Math.ceil(chunk.content.length / 4),
          createUser: doc.createUser,
        }),
      );
      await this.chunkRepo.save(chunks);

      // 6. 更新文档状态
      await this.documentRepo.update(doc.id, {
        processingStatus: PROCESSING_STATUS.Completed,
        chunkCount: chunks.length,
        processedChunks: chunks.length,
      });

      this.logger.log(`文档向量化完成: ${attachment.fileName}，共 ${chunks.length} 个分片`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`文档向量化失败: ${attachment.fileName} - ${message}`);
      await this.documentRepo.update(doc.id, {
        processingStatus: PROCESSING_STATUS.Failed,
        errorMessage: message,
      });
    }
  }

  /** 获取临时目录 */
  getTempDir(): string {
    const uploadRootDir = getConfig<string>(RagConfigKeys.UploadRootDir, 'public/uploads', false);
    return path.join(uploadRootDir, '_rag_tmp');
  }

  /** 解析附件描述来源：options.description > FileService 获取 */
  private async resolveDescription(
    attachment: ResolvedAttachment,
    providedDescription?: string,
  ): Promise<string> {
    if (providedDescription !== undefined) {
      return providedDescription;
    }
    if (attachment.fileId) {
      try {
        const fileRes = await this.fileServiceClient.getFileDetail({ id: attachment.fileId });
        return fileRes.data?.description ?? '';
      } catch {
        // 文件服务不可用时忽略
      }
    }
    return '';
  }

  /** 根据文件类型分发到对应解析器 */
  private async extractContent(attachment: ResolvedAttachment) {
    const fileType = MIME_TO_FILE_TYPE[attachment.mimeType] ?? FILE_TYPE_CATEGORY.Document;
    switch (fileType) {
      case FILE_TYPE_CATEGORY.Document:
        return this.documentProcessor.parseDocument({
          filePath: attachment.filePath,
          mimeType: attachment.mimeType || 'text/plain',
          fileName: attachment.fileName,
        });
      case FILE_TYPE_CATEGORY.Image:
        return this.mediaProcessor.processImage({
          filePath: attachment.filePath,
          fileName: attachment.fileName,
          fileUrl: attachment.fileUrl ?? undefined,
        });
      case FILE_TYPE_CATEGORY.Audio:
        return this.mediaProcessor.processAudio({
          filePath: attachment.filePath,
          fileName: attachment.fileName,
          fileUrl: attachment.fileUrl ?? undefined,
        });
      case FILE_TYPE_CATEGORY.Video:
        return this.mediaProcessor.processVideo({
          filePath: attachment.filePath,
          fileName: attachment.fileName,
          fileUrl: attachment.fileUrl ?? undefined,
        });
      default:
        return this.documentProcessor.parseDocument({
          filePath: attachment.filePath,
          mimeType: 'text/plain',
          fileName: attachment.fileName,
        });
    }
  }
}
