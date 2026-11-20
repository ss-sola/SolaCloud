import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ChatRagToolService,
  RankedFragment,
  SourceRecord,
} from '../../../src/modules/chat/service/chat-rag-tool.service';
import {
  ChatRetrievalService,
  RetrievalResult,
} from '../../../src/modules/chat/service/chat-retrieval.service';
import { RagConfigService } from '../../../src/modules/config/service/rag-config.service';

// ─── Mocks ──────────────────────────────────────────────────────────────────

let retrieveMock: ReturnType<typeof vi.fn>;

const createMockRetrievalService = (): ChatRetrievalService => {
  retrieveMock = vi.fn().mockImplementation(async (_options) => []);
  return {
    retrieve: retrieveMock,
  } as unknown as ChatRetrievalService;
};

const createMockRagConfigService = () =>
  ({
    getEmbeddingConfig: vi.fn().mockResolvedValue({
      model: 'text-embedding-3-small',
      dimension: 1536,
      baseUrl: '',
      apiKey: 'test-key',
      chunkSize: 1000,
      chunkOverlap: 200,
      retrievalTopK: 5,
      retrievalScoreThreshold: 0.7,
    }),
  }) as unknown as RagConfigService;

const mockRetrievalService = createMockRetrievalService();
const mockRagConfigService = createMockRagConfigService();

let service: ChatRagToolService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new ChatRagToolService(mockRetrievalService, mockRagConfigService);
});

// ─── Test data helpers ──────────────────────────────────────────────────────

function makeRetrievalResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    chunkId: 1,
    documentId: 1,
    fileId: 100,
    fileName: 'test.pdf',
    fileUrl: 'http://example.com/test.pdf',
    content: 'Sample retrieval content for testing purposes.',
    score: 0.95,
    metadata: null,
    ...overrides,
  };
}

function parseToolResult(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

// ─── Test suites ────────────────────────────────────────────────────────────

describe('ChatRagToolService', () => {
  describe('tool creation', () => {
    it('should create a DynamicStructuredTool with correct name and schema', () => {
      const tool = service.createTool({ count: 0 });

      expect(tool.name).toBe('rag_retrieve');
      expect(tool.description).toContain('知识库');
      expect(tool.description).toContain('去重');
    });

    it('should bind execute logic with provided context', () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      expect(tool).toBeDefined();
      expect(tool.func).toBeDefined();
    });
  });

  describe('main agent and sub-agent invocation', () => {
    it('should be callable by the main agent via createTool', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([makeRetrievalResult({ chunkId: 1, score: 0.95 })]);

      const result = await tool.func({ query: 'test query' });
      const parsed = parseToolResult(result);

      expect(parsed.success).toBe(true);
      expect(parsed.fragments).toBeDefined();
      expect(Array.isArray(parsed.fragments)).toBe(true);
    });

    it('should be callable by a sub-agent with shared cumulative counter', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 1, score: 0.95 }),
        makeRetrievalResult({ chunkId: 2, score: 0.88 }),
      ]);

      // First call
      await tool.func({ query: 'first query' });
      expect(cumRef.count).toBe(2);

      // Second call simulates sub-agent invocation
      retrieveMock.mockResolvedValue([makeRetrievalResult({ chunkId: 3, score: 0.8 })]);
      await tool.func({ query: 'second query' });
      expect(cumRef.count).toBe(3);
    });

    it('should share knowledge base authorization between main and sub agents', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 1, documentId: 1, score: 0.95 }),
        makeRetrievalResult({ chunkId: 2, documentId: 2, score: 0.88 }),
      ]);

      const result = parseToolResult(await tool.func({ query: 'shared auth test' }));
      expect(result.success).toBe(true);
      expect((result.fragments as Array<Record<string, unknown>>).length).toBe(2);
    });
  });

  describe('source aggregation and deduplication', () => {
    it('should deduplicate fragments by chunkId keeping first occurrence then sort by score', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      // deduplicateAndSort keeps the first occurrence of each chunkId,
      // then sorts by score desc / chunkId asc
      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 1, score: 0.95, content: 'highest score' }),
        makeRetrievalResult({ chunkId: 2, score: 0.9 }),
        makeRetrievalResult({ chunkId: 1, score: 0.8, content: 'lower score duplicate' }),
      ]);

      const result = parseToolResult(await tool.func({ query: 'dedup test' }));
      const fragments = result.fragments as RankedFragment[];

      expect(fragments.length).toBe(2);
      // chunkId 1: first occurrence had score 0.95 (kept), chunkId 2: score 0.90
      // After sort by score desc: chunkId 1 (0.95) comes first, chunkId 2 (0.90) second
      expect(fragments[0].chunkId).toBe(1);
      expect(fragments[0].score).toBe(0.95);
      expect(fragments[1].chunkId).toBe(2);
    });

    it('should deduplicate source records by chunkId keeping first occurrence', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      // First chunkId 1 occurrence has score 0.90 (kept), second is duplicate
      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 1, score: 0.9 }),
        makeRetrievalResult({ chunkId: 1, score: 0.95 }),
        makeRetrievalResult({ chunkId: 2, score: 0.8 }),
      ]);

      const result = parseToolResult(await tool.func({ query: 'source dedup test' }));
      const sources = result.sources as SourceRecord[];

      expect(sources.length).toBe(2);
      const sourceChunk1 = sources.find((s) => s.chunkId === 1);
      // First occurrence score 0.90 is kept (then sorted)
      expect(sourceChunk1!.score).toBe(0.9);
    });

    it('should sort results by score descending then chunkId ascending', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 5, score: 0.9 }),
        makeRetrievalResult({ chunkId: 3, score: 0.9 }),
        makeRetrievalResult({ chunkId: 1, score: 0.95 }),
        makeRetrievalResult({ chunkId: 2, score: 0.85 }),
      ]);

      const result = parseToolResult(await tool.func({ query: 'sort test' }));
      const fragments = result.fragments as RankedFragment[];

      expect(fragments[0].score).toBe(0.95);
      expect(fragments[0].chunkId).toBe(1);
      // Same score 0.90: chunkId 3 should come before 5
      expect(fragments[1].chunkId).toBe(3);
      expect(fragments[2].chunkId).toBe(5);
    });

    it('should aggregate scores correctly with rounding', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([makeRetrievalResult({ chunkId: 1, score: 0.954321 })]);

      const result = parseToolResult(await tool.func({ query: 'rounding test' }));
      const fragments = result.fragments as RankedFragment[];
      // Score should be rounded to 4 decimal places
      expect(fragments[0].score).toBe(0.9543);
    });

    it('should include fragment content truncated to MAX_FRAGMENT_LENGTH', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      const longContent = 'x'.repeat(5000);
      retrieveMock.mockResolvedValue([makeRetrievalResult({ chunkId: 1, content: longContent })]);

      const result = parseToolResult(await tool.func({ query: 'truncation test' }));
      const fragments = result.fragments as RankedFragment[];
      expect(fragments[0].content.length).toBe(2000);
    });
  });

  describe('no knowledge base scenario', () => {
    it('should use default knowledgeBaseId 0 when none specified', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([]);

      const result = parseToolResult(await tool.func({ query: 'no kb test' }));
      expect(result.success).toBe(true);
      expect(result.fragments as Array<Record<string, unknown>>).toEqual([]);
    });

    it('should return empty fragments when retrieval returns nothing', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([]);

      const result = parseToolResult(await tool.func({ query: 'empty result test' }));
      expect(result.success).toBe(true);
      expect(result.fragments as Array<Record<string, unknown>>).toEqual([]);
    });

    it('should use truthy knowledgeBaseId directly (including invalid IDs)', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([]);

      await tool.func({ query: 'invalid kb test', knowledgeBaseId: 999 });
      // 999 is truthy, so it is passed through directly (no auth validation)
      expect(retrieveMock).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBaseId: 999 }));
    });
  });

  describe('retrieval failure scenario', () => {
    it('should return error result when retrieve throws an exception', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockRejectedValue(new Error('database connection refused'));

      const result = parseToolResult(await tool.func({ query: 'failure test' }));
      expect(result.success).toBe(false);
      expect(result.error).toBe('检索异常');
      expect(result.message).toContain('database connection refused');
      expect(result.fragments).toEqual([]);
    });

    it('should handle non-Error exceptions gracefully', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockRejectedValue('string error');

      const result = parseToolResult(await tool.func({ query: 'string error test' }));
      expect(result.success).toBe(false);
      expect(result.error).toBe('检索异常');
    });

    it('should return empty fragments on retrieval failure', async () => {
      const cumRef = { count: 5 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockRejectedValue(new Error('timeout'));

      const result = parseToolResult(await tool.func({ query: 'timeout test' }));
      const stats = result.stats as {
        fragmentCount: number;
        cumulativeCount: number;
        rawCount: number;
      };
      expect(stats.fragmentCount).toBe(0);
      expect(stats.cumulativeCount).toBe(5);
    });
  });

  describe('query validation', () => {
    it('should reject empty query', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      const result = parseToolResult(await tool.func({ query: '' }));
      expect(result.success).toBe(false);
      expect(result.error).toBe('检索异常');
    });

    it('should reject whitespace-only query', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      const result = parseToolResult(await tool.func({ query: '   ' }));
      expect(result.success).toBe(false);
    });

    it('should truncate query exceeding MAX_QUERY_LENGTH', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([makeRetrievalResult({ chunkId: 1, score: 0.9 })]);

      const longQuery = 'a'.repeat(2000);
      const result = parseToolResult(await tool.func({ query: longQuery }));
      expect(result.success).toBe(true);
    });
  });

  describe('topK clamping', () => {
    it('should use default topK of 5 when not specified', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([makeRetrievalResult({ chunkId: 1, score: 0.9 })]);

      await tool.func({ query: 'topK default' });
      // effectiveTopK = min(defaultTopK=5, retrievalTopK=5) = 5
      expect(retrieveMock).toHaveBeenCalledWith(expect.objectContaining({ topK: 5 }));
    });

    it('should clamp topK to MIN(inputTopK, retrievalTopK)', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([makeRetrievalResult({ chunkId: 1, score: 0.9 })]);

      // input topK=100, but retrievalTopK=5, so effective is min(100, 5)=5
      await tool.func({ query: 'topK clamp', topK: 100 });
      expect(retrieveMock).toHaveBeenCalledWith(expect.objectContaining({ topK: 5 }));
    });

    it('should accept valid topK within range', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([makeRetrievalResult({ chunkId: 1, score: 0.9 })]);

      // input topK=10, retrievalTopK=5, effective is min(10, 5)=5
      await tool.func({ query: 'topK valid', topK: 10 });
      expect(retrieveMock).toHaveBeenCalledWith(expect.objectContaining({ topK: 5 }));
    });
  });

  describe('authorization filtering', () => {
    // Note: authorization filtering has been removed; all retrieved results are returned.
    it('should return all results without authorization filtering', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 1, documentId: 1, score: 0.95 }),
        makeRetrievalResult({ chunkId: 2, documentId: 99, score: 0.9 }),
      ]);

      const result = parseToolResult(await tool.func({ query: 'no auth filter test' }));
      const fragments = result.fragments as RankedFragment[];
      expect(fragments.length).toBe(2);
    });

    it('should return all results when all are from unauthorized bases', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 1, documentId: 99, score: 0.95 }),
      ]);

      const result = parseToolResult(await tool.func({ query: 'all results' }));
      const fragments = result.fragments as RankedFragment[];
      expect(fragments.length).toBe(1);
      expect(fragments[0].chunkId).toBe(1);
    });
  });

  describe('stats', () => {
    it('should return correct fragmentCount and cumulativeCount', async () => {
      const cumRef = { count: 10 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 1, score: 0.95 }),
        makeRetrievalResult({ chunkId: 2, score: 0.88 }),
      ]);

      const result = parseToolResult(await tool.func({ query: 'stats test' }));
      const stats = result.stats as {
        fragmentCount: number;
        cumulativeCount: number;
        rawCount: number;
      };

      expect(stats.fragmentCount).toBe(2);
      expect(stats.cumulativeCount).toBe(12);
      expect(stats.rawCount).toBe(2);
    });
  });

  describe('resolveKnowledgeBaseId priority', () => {
    it('should prefer explicit knowledgeBaseId when provided', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 1, documentId: 2, score: 0.9 }),
      ]);

      await tool.func({ query: 'explicit kb test', knowledgeBaseId: 2 });
      expect(retrieveMock).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBaseId: 2 }));
    });

    it('should use 0 as default knowledgeBaseId when explicit is omitted', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 1, documentId: 5, score: 0.9 }),
      ]);

      await tool.func({ query: 'default kb test' });
      expect(retrieveMock).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBaseId: 0 }));
    });

    it('should use explicit knowledgeBaseId as-is (no authorization check)', async () => {
      const cumRef = { count: 0 };
      const tool = service.createTool(cumRef);

      retrieveMock.mockResolvedValue([
        makeRetrievalResult({ chunkId: 1, documentId: 2, score: 0.9 }),
      ]);

      // Any explicit kbId is passed through directly
      await tool.func({ query: 'direct kb test', knowledgeBaseId: 99 });
      expect(retrieveMock).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBaseId: 99 }));
    });
  });
});
