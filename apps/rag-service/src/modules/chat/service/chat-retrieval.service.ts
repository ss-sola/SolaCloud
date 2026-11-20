import { Injectable, Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RagConfigService } from '../../config/service/rag-config.service';
import { FileServiceClient } from '../../../client/file-service.client';
import type { FileDetailResponse } from '../../../client/file-service.client';
import { DocumentChunk } from '../../knowledge/entity/document-chunk.entity';
import { KnowledgeDocument } from '../../knowledge/entity/knowledge-document.entity';
import { EmbeddingService } from '../../knowledge/service/embedding.service';

/** 检索结果 */
export interface RetrievalResult {
  chunkId: number;
  documentId: number;
  fileId: number | null;
  fileName: string;
  fileUrl: string | null;
  mimeType?: string;
  extension?: string;
  isExtracted?: boolean;
  previewUrl?: string;
  content: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

/**
 * 向量检索服务。
 * 使用 pgvector 进行相似度搜索，返回最相关的文档分片。
 */
@Injectable()
export class ChatRetrievalService {
  private readonly logger = new Logger(ChatRetrievalService.name);
  private readonly chunkRepo: Repository<DocumentChunk>;
  private readonly documentRepo: Repository<KnowledgeDocument>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly embeddingService: EmbeddingService,
    private readonly fileServiceClient: FileServiceClient,
    private readonly ragConfigService: RagConfigService,
  ) {
    this.chunkRepo = this.dataSource.getRepository(DocumentChunk);
    this.documentRepo = this.dataSource.getRepository(KnowledgeDocument);
  }

  /** 基于用户查询进行向量相似度检索 */
  async retrieve(options: {
    query: string;
    knowledgeBaseId?: number;
    topK?: number;
    scoreThreshold?: number;
  }): Promise<RetrievalResult[]> {
    const embedConfig = await this.ragConfigService.getEmbeddingConfig();
    const topK = options.topK ?? embedConfig.retrievalTopK;
    const scoreThreshold = options.scoreThreshold ?? embedConfig.retrievalScoreThreshold;

    // 先检查是否有可用的向量数据，避免无谓的 embedding 调用
    const countQuery = this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from('rag_document_chunk', 'chunk')
      .where('chunk.embedding IS NOT NULL');

    if (options.knowledgeBaseId) {
      countQuery.andWhere('chunk.knowledge_base_id = :kbId', {
        kbId: options.knowledgeBaseId,
      });
    }

    const countResult = await countQuery.getRawOne<{ count: string }>();
    const availableChunks = Number.parseInt(countResult?.count ?? '0', 10);

    if (availableChunks === 0) {
      this.logger.warn('知识库中没有可用的向量数据，跳过检索');
      return [];
    }

    // 将查询文本向量化
    const queryEmbedding = await this.embeddingService.embedText(options.query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // 使用 pgvector 进行余弦相似度搜索
    let query = this.dataSource
      .createQueryBuilder()
      .select('chunk.id', 'chunkId')
      .addSelect('chunk.document_id', 'documentId')
      .addSelect('chunk.content', 'content')
      .addSelect('chunk.metadata', 'metadata')
      .addSelect(`1 - (chunk.embedding <=> '${embeddingStr}'::vector)`, 'score')
      .from('rag_document_chunk', 'chunk')
      .where('chunk.embedding IS NOT NULL')
      .orderBy('score', 'DESC')
      .limit(topK);

    if (options.knowledgeBaseId) {
      query = query.andWhere('chunk.knowledge_base_id = :kbId', {
        kbId: options.knowledgeBaseId,
      });
    }

    const rawResults = await query.getRawMany<{
      chunkId: number;
      documentId: number;
      content: string;
      metadata: Record<string, unknown> | null;
      score: number;
    }>();

    // 过滤低分结果
    const filteredResults = rawResults.filter((r) => r.score >= scoreThreshold);

    if (filteredResults.length === 0) {
      return [];
    }

    // 补充文档信息
    const documentIds = [...new Set(filteredResults.map((r) => r.documentId))];
    const documents = await this.documentRepo.findByIds(documentIds);
    const docMap = new Map(documents.map((d) => [d.id, d]));

    // 批量从 middleware-service 获取文件详情
    const fileIds = [
      ...new Set(documents.map((d) => d.fileId).filter((id): id is number => id !== null)),
    ];
    const fileMap = new Map<number, FileDetailResponse>();

    if (fileIds.length > 0) {
      try {
        const batchResult = await this.fileServiceClient.getFileDetailBatch({ ids: fileIds });
        if (batchResult?.data) {
          for (const file of batchResult.data) {
            fileMap.set(file.id, file);
          }
        }
      } catch (err) {
        this.logger.warn(`批量查询文件详情失败: ${err instanceof Error ? err.message : err}`);
      }
    }

    return filteredResults.map((r) => {
      const doc = docMap.get(r.documentId);
      const fileInfo = doc?.fileId ? fileMap.get(doc.fileId) : undefined;
      return {
        chunkId: r.chunkId,
        documentId: r.documentId,
        fileId: doc?.fileId ?? null,
        fileName: fileInfo?.originalName ?? '',
        fileUrl: fileInfo?.url ?? null,
        mimeType: fileInfo?.mimeType,
        extension: fileInfo?.extension,
        isExtracted: fileInfo?.isExtracted,
        previewUrl: fileInfo?.previewUrl,
        content: r.content,
        score: r.score,
        metadata: r.metadata,
      };
    });
  }
}
