import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { KnowledgeService } from '@/modules/knowledge/service/knowledge.service';
import { DocumentVectorizationService } from '@/modules/knowledge/service/document-vectorization.service';
import { EmbeddingService } from '@/modules/knowledge/service/embedding.service';
import { RagConfigService } from '@/modules/config/service/rag-config.service';
import { DocumentChunkService } from '@/modules/knowledge/service/document-chunk.service';
import { KnowledgeBase } from '@/modules/knowledge/entity/knowledge-base.entity';
import { KnowledgeDocument } from '@/modules/knowledge/entity/knowledge-document.entity';
import { DocumentChunk } from '@/modules/knowledge/entity/document-chunk.entity';
import { FileServiceClient } from '@/client/file-service.client';

vi.mock('@nest-cloud/sdk', async () => {
  const actual = await vi.importActual<typeof import('@nest-cloud/sdk')>('@nest-cloud/sdk');
  return {
    ...actual,
    getConfig: vi.fn((key: string, defaultValue?: unknown) => {
      if (key === 'UploadRootDir') return 'E:/uploads';
      if (key === 'UploadPublicBaseUrl') return 'http://localhost:3300/uploads';
      return defaultValue;
    }),
  };
});

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let dataSource: DataSource;
  let embeddingService: EmbeddingService;
  let knowledgeBaseRepo: Repository<KnowledgeBase>;
  let documentRepo: Repository<KnowledgeDocument>;
  let chunkRepo: Repository<DocumentChunk>;
  let vectorizationService: DocumentVectorizationService;
  let rawOneMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    knowledgeBaseRepo = {
      create: vi.fn((data) => data as KnowledgeBase),
      save: vi.fn((entity) => Promise.resolve({ id: 1, ...entity } as KnowledgeBase)),
      find: vi.fn(() => Promise.resolve([])),
      findOneBy: vi.fn(() =>
        Promise.resolve({
          id: 1,
          name: 'Test KB',
          embeddingModel: 'text-embedding-3-small',
        } as KnowledgeBase),
      ),
    } as unknown as Repository<KnowledgeBase>;

    documentRepo = {
      create: vi.fn((data) => data as KnowledgeDocument),
      save: vi.fn((entity) => Promise.resolve({ id: 1, ...entity } as KnowledgeDocument)),
      find: vi.fn(() => Promise.resolve([])),
      findOne: vi.fn(() => Promise.resolve(null)),
      update: vi.fn(() => Promise.resolve()),
      findOneBy: vi.fn(() => Promise.resolve(null)),
    } as unknown as Repository<KnowledgeDocument>;

    chunkRepo = {
      create: vi.fn((data) => data as DocumentChunk),
      save: vi.fn((entity) => Promise.resolve(entity)),
    } as unknown as Repository<DocumentChunk>;

    rawOneMock = vi.fn();
    dataSource = {
      getRepository: vi.fn((entity) => {
        if (entity === KnowledgeBase) return knowledgeBaseRepo;
        if (entity === KnowledgeDocument) return documentRepo;
        if (entity === DocumentChunk) return chunkRepo;
        return {} as Repository<never>;
      }),
      createQueryBuilder: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getRawOne: rawOneMock,
      })),
    } as unknown as DataSource;

    embeddingService = {
      getModelName: vi.fn(() => 'text-embedding-3-small'),
      getDimension: vi.fn(() => 1536),
      embedTexts: vi.fn((texts) =>
        Promise.resolve(texts.map(() => Array.from({ length: 3 }, () => 0.1))),
      ),
    } as unknown as EmbeddingService;

    const fileServiceClient = {
      getFileDetail: vi.fn(() =>
        Promise.resolve({
          data: {
            id: 3,
            originalName: 'slides.pptx',
            storagePath: '2026/06/20/slides.pptx',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            url: 'http://localhost:3300/uploads/2026/06/20/slides.pptx',
          },
        }),
      ),
    } as unknown as FileServiceClient;

    const ragConfigService = {
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
      getMultimodalConfig: vi.fn(() =>
        Promise.resolve({
          model: 'gpt-4o',
          baseUrl: '',
          apiKey: 'test-api-key',
        }),
      ),
    } as unknown as RagConfigService;

    const documentChunkService = {} as unknown as DocumentChunkService;

    vectorizationService = {
      vectorize: vi.fn(() => Promise.resolve()),
      getTempDir: vi.fn(() => 'E:/uploads/_rag_tmp'),
    } as unknown as DocumentVectorizationService;

    service = new KnowledgeService(
      documentRepo,
      dataSource,
      embeddingService,
      fileServiceClient,
      ragConfigService,
      documentChunkService,
      vectorizationService,
    );
  });

  describe('createKnowledgeBase', () => {
    it('should create a knowledge base with embedding config', async () => {
      const result = await service.createKnowledgeBase({
        name: 'Test Knowledge Base',
        description: 'Test description',
        createUser: 100,
      });

      expect(knowledgeBaseRepo.create).toHaveBeenCalledWith({
        name: 'Test Knowledge Base',
        description: 'Test description',
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
        createUser: 100,
        updateUser: 100,
      });
      expect(knowledgeBaseRepo.save).toHaveBeenCalled();
      expect(result.id).toBe(1);
    });

    it('should create knowledge base without optional fields', async () => {
      const result = await service.createKnowledgeBase({
        name: 'Simple KB',
      });

      expect(knowledgeBaseRepo.create).toHaveBeenCalledWith({
        name: 'Simple KB',
        description: null,
        embeddingModel: 'text-embedding-3-small',
        embeddingDimension: 1536,
        createUser: undefined,
        updateUser: undefined,
      });
      expect(result.id).toBe(1);
    });
  });

  describe('ingestAttachments', () => {
    it('should throw error when knowledge base not found', async () => {
      vi.mocked(knowledgeBaseRepo.findOneBy).mockResolvedValue(null);

      await expect(
        service.ingestAttachments({
          knowledgeBaseId: 999,
          attachments: [],
          createUser: 100,
        }),
      ).rejects.toThrow('知识库不存在');
    });

    it('should handle empty attachments array', async () => {
      const result = await service.ingestAttachments({
        knowledgeBaseId: 1,
        attachments: [],
        createUser: 100,
      });

      expect(result).toEqual([]);
    });

    it('should resolve uploaded file by fileId and schedule processing', async () => {
      const result = await service.ingestAttachments({
        knowledgeBaseId: 1,
        attachments: [{ fileId: 3 }],
        createUser: 100,
      });

      // Wait for the fire-and-forget vectorize to complete
      await new Promise((resolve) => setImmediate(resolve));

      expect(documentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 3,
        }),
      );
      expect(vectorizationService.vectorize).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 3 }),
        expect.objectContaining({
          fileId: 3,
          fileName: 'slides.pptx',
        }),
        expect.objectContaining({ embedConfig: expect.anything() }),
      );
      expect(result).toHaveLength(1);
    });

    it('should reject attachment without fileId and file path fields', async () => {
      await expect(
        service.ingestAttachments({
          knowledgeBaseId: 1,
          attachments: [{ fileUrl: 'http://localhost/test' }],
          createUser: 100,
        }),
      ).rejects.toThrow('附件缺少 fileId 或必要的文件信息');
    });
  });

  describe('Text splitting logic', () => {
    it('should split long text with overlap', () => {
      const text = 'AAAAAABBBBBCCCCC';
      const chunkSize = 10;
      const overlap = 3;

      const chunks: string[] = [];
      let start = 0;

      while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        chunks.push(text.slice(start, end));
        start = end - overlap;
        if (end === text.length) break;
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].length).toBeLessThanOrEqual(chunkSize);
    });

    it('should normalize CRLF to LF', () => {
      const text = 'Line1\r\nLine2\r\nLine3';
      const normalized = text.replace(/\r\n/g, '\n');

      expect(normalized).not.toContain('\r\n');
      expect(normalized).toBe('Line1\nLine2\nLine3');
    });

    it('should find paragraph break in text region', () => {
      const text = 'First paragraph.\n\nSecond paragraph.';
      const paragraphBreakIndex = text.indexOf('\n\n');

      expect(paragraphBreakIndex).toBeGreaterThan(0);
      expect(text.slice(0, paragraphBreakIndex)).toBe('First paragraph.');
    });
  });
});
