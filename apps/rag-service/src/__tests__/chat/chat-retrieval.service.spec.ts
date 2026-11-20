import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatRetrievalService } from '@/modules/chat/service/chat-retrieval.service';
import { EmbeddingService } from '@/modules/knowledge/service/embedding.service';
import { FileServiceClient } from '@/client/file-service.client';
import { DataSource } from 'typeorm';

const mockRagConfigService = {
  getEmbeddingConfig: vi.fn(() =>
    Promise.resolve({
      model: 'text-embedding-3-small',
      dimension: 1536,
      baseUrl: '',
      apiKey: 'test-api-key',
      chunkSize: 1000,
      chunkOverlap: 200,
      retrievalTopK: 5,
      retrievalScoreThreshold: 0.7,
    }),
  ),
} as const;

describe('ChatRetrievalService', () => {
  let service: ChatRetrievalService;
  let embeddingService: EmbeddingService;
  let fileServiceClient: FileServiceClient;
  let dataSource: DataSource;

  beforeEach(() => {
    embeddingService = {
      embedText: vi.fn(() => Promise.resolve(Array.from({ length: 1536 }, () => 0.1))),
    } as unknown as EmbeddingService;

    fileServiceClient = {
      getFileDetailBatch: vi.fn(() =>
        Promise.resolve({
          data: [
            {
              id: 1,
              originalName: 'test.docx',
              url: 'http://localhost/uploads/test.docx',
              previewUrl: null,
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              extension: 'docx',
              isExtracted: false,
            },
          ],
        }),
      ),
    } as unknown as FileServiceClient;

    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      getRawOne: vi.fn(() => Promise.resolve({ count: '10' })),
      getRawMany: vi.fn(() =>
        Promise.resolve([
          {
            chunkId: 1,
            documentId: 1,
            fileId: 1,
            content: 'Test content about RAG',
            score: 0.95,
          },
          {
            chunkId: 2,
            documentId: 1,
            fileId: 1,
            content: 'More information about retrieval',
            score: 0.88,
          },
        ]),
      ),
    };

    const mockRepo = {
      query: vi.fn(),
      findByIds: vi.fn(() => Promise.resolve([{ id: 1, fileId: 1, knowledgeBaseId: 1 }])),
    };

    dataSource = {
      query: vi.fn(() => Promise.resolve([])),
      getRepository: vi.fn(() => mockRepo),
      createQueryBuilder: vi.fn(() => mockQueryBuilder),
    } as unknown as DataSource;

    service = new ChatRetrievalService(
      dataSource,
      embeddingService,
      fileServiceClient,
      mockRagConfigService as never,
    );
  });

  describe('retrieve', () => {
    it('should retrieve relevant chunks with knowledge base filter', async () => {
      const result = await service.retrieve({
        query: 'What is RAG?',
        knowledgeBaseId: 1,
        topK: 5,
      });

      expect(embeddingService.embedText).toHaveBeenCalledWith('What is RAG?');
      expect(dataSource.createQueryBuilder).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        chunkId: 1,
        documentId: 1,
        fileId: 1,
        content: 'Test content about RAG',
        score: 0.95,
      });
    });

    it('should retrieve without knowledge base filter', async () => {
      const result = await service.retrieve({
        query: 'test query',
      });

      expect(embeddingService.embedText).toHaveBeenCalled();
      expect(dataSource.createQueryBuilder).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    it('should use default topK value', async () => {
      await service.retrieve({
        query: 'test',
        knowledgeBaseId: 1,
      });

      expect(embeddingService.embedText).toHaveBeenCalled();
    });

    it('should return empty array when no chunks match', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getRawOne: vi.fn(() => Promise.resolve({ count: '0' })),
        getRawMany: vi.fn(() => Promise.resolve([])),
      };

      vi.mocked(dataSource.createQueryBuilder).mockReturnValue(mockQueryBuilder as never);

      const result = await service.retrieve({
        query: 'nonexistent topic',
        knowledgeBaseId: 1,
      });

      expect(result).toEqual([]);
      // 当 count 为 0 时不应调用 embedding
      expect(embeddingService.embedText).not.toHaveBeenCalled();
    });
  });
});
