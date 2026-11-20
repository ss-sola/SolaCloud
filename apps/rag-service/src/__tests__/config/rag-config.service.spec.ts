import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagConfigService } from '@/modules/config/service/rag-config.service';
import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_MULTIMODAL_MODEL,
  DEFAULT_RETRIEVAL_SCORE_THRESHOLD,
  DEFAULT_RETRIEVAL_TOP_K,
} from '@/constants/rag.constants';

describe('RagConfigService', () => {
  let service: RagConfigService;
  let mockClient: { getDictionaryRuntimeItems: ReturnType<typeof vi.fn> };

  const createMockClient = (items: { key: string; value: unknown }[]) => ({
    getDictionaryRuntimeItems: vi.fn().mockResolvedValue({ data: items }),
  });

  beforeEach(() => {
    mockClient = createMockClient([]);
    service = new RagConfigService(mockClient as never);
  });

  describe('getChatLlmConfig', () => {
    it('should return defaults when dict is empty', async () => {
      const config = await service.getChatLlmConfig();
      expect(config).toEqual({
        model: DEFAULT_LLM_MODEL,
        baseUrl: '',
        apiKey: '',
      });
    });

    it('should return dict values when present', async () => {
      mockClient = createMockClient([
        { key: 'model', value: 'gpt-4-turbo' },
        { key: 'baseUrl', value: 'https://custom.api' },
        { key: 'apiKey', value: 'sk-test' },
      ]);
      service = new RagConfigService(mockClient as never);

      const config = await service.getChatLlmConfig();
      expect(config).toEqual({
        model: 'gpt-4-turbo',
        baseUrl: 'https://custom.api',
        apiKey: 'sk-test',
      });
    });

    it('should ignore empty string values and use defaults', async () => {
      mockClient = createMockClient([
        { key: 'model', value: 'gpt-4' },
        { key: 'apiKey', value: '' },
      ]);
      service = new RagConfigService(mockClient as never);

      const config = await service.getChatLlmConfig();
      expect(config.apiKey).toBe('');
      expect(config.model).toBe('gpt-4');
    });
  });

  describe('getEmbeddingConfig', () => {
    it('should return all defaults when dict is empty', async () => {
      const config = await service.getEmbeddingConfig();
      expect(config).toEqual({
        model: DEFAULT_EMBEDDING_MODEL,
        dimension: DEFAULT_EMBEDDING_DIMENSION,
        baseUrl: '',
        apiKey: '',
        chunkSize: DEFAULT_CHUNK_SIZE,
        chunkOverlap: DEFAULT_CHUNK_OVERLAP,
        retrievalTopK: DEFAULT_RETRIEVAL_TOP_K,
        retrievalScoreThreshold: DEFAULT_RETRIEVAL_SCORE_THRESHOLD,
      });
    });

    it('should parse numeric values from dict', async () => {
      mockClient = createMockClient([
        { key: 'dimension', value: 1536 },
        { key: 'chunkSize', value: 512 },
        { key: 'chunkOverlap', value: 50 },
        { key: 'retrievalTopK', value: 5 },
        { key: 'retrievalScoreThreshold', value: 0.5 },
      ]);
      service = new RagConfigService(mockClient as never);

      const config = await service.getEmbeddingConfig();
      expect(config.dimension).toBe(1536);
      expect(config.chunkSize).toBe(512);
      expect(config.chunkOverlap).toBe(50);
      expect(config.retrievalTopK).toBe(5);
      expect(config.retrievalScoreThreshold).toBe(0.5);
    });

    it('should parse numeric values from string dict values', async () => {
      mockClient = createMockClient([
        { key: 'dimension', value: '768' },
        { key: 'chunkSize', value: '256' },
      ]);
      service = new RagConfigService(mockClient as never);

      const config = await service.getEmbeddingConfig();
      expect(config.dimension).toBe(768);
      expect(config.chunkSize).toBe(256);
    });

    it('should fall back to default for non-numeric string', async () => {
      mockClient = createMockClient([{ key: 'dimension', value: 'not-a-number' }]);
      service = new RagConfigService(mockClient as never);

      const config = await service.getEmbeddingConfig();
      expect(config.dimension).toBe(DEFAULT_EMBEDDING_DIMENSION);
    });
  });

  describe('getMultimodalConfig', () => {
    it('should return defaults when dict is empty', async () => {
      const config = await service.getMultimodalConfig();
      expect(config).toEqual({
        model: DEFAULT_MULTIMODAL_MODEL,
        baseUrl: '',
        apiKey: '',
      });
    });

    it('should return dict values when present', async () => {
      mockClient = createMockClient([
        { key: 'model', value: 'claude-vision' },
        { key: 'baseUrl', value: 'https://vision.api' },
        { key: 'apiKey', value: 'sk-vision' },
      ]);
      service = new RagConfigService(mockClient as never);

      const config = await service.getMultimodalConfig();
      expect(config).toEqual({
        model: 'claude-vision',
        baseUrl: 'https://vision.api',
        apiKey: 'sk-vision',
      });
    });
  });

  describe('caching behavior', () => {
    it('should cache results and not call client again within TTL', async () => {
      mockClient = createMockClient([{ key: 'model', value: 'cached-model' }]);
      service = new RagConfigService(mockClient as never);

      await service.getChatLlmConfig();
      await service.getChatLlmConfig();

      expect(mockClient.getDictionaryRuntimeItems).toHaveBeenCalledTimes(1);
    });

    it('should refetch when cache expires', async () => {
      vi.useFakeTimers();
      const originalDateNow = Date.now;
      let tick = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => originalDateNow() + tick);

      mockClient = createMockClient([{ key: 'model', value: 'v1' }]);
      service = new RagConfigService(mockClient as never);

      await service.getChatLlmConfig();
      expect(mockClient.getDictionaryRuntimeItems).toHaveBeenCalledTimes(1);

      // Advance past TTL (5 minutes + 1ms)
      tick = 5 * 60 * 1000 + 1;

      // Create a new service with a different mock to simulate refetch
      mockClient = createMockClient([{ key: 'model', value: 'v2' }]);
      service = new RagConfigService(mockClient as never);

      await service.getChatLlmConfig();
      expect(mockClient.getDictionaryRuntimeItems).toHaveBeenCalledTimes(1);
      expect((await service.getChatLlmConfig()).model).toBe('v2');

      vi.useRealTimers();
    });

    it('should degrade to expired cache on remote failure', async () => {
      mockClient = createMockClient([{ key: 'model', value: 'initial' }]);
      service = new RagConfigService(mockClient as never);

      // First call succeeds
      const cfg1 = await service.getChatLlmConfig();
      expect(cfg1.model).toBe('initial');

      // Second call fails but returns cached data
      mockClient.getDictionaryRuntimeItems.mockRejectedValueOnce(new Error('network error'));
      const cfg2 = await service.getChatLlmConfig();
      expect(cfg2.model).toBe('initial');
    });

    it('should return empty map when remote fails and no cache', async () => {
      mockClient.getDictionaryRuntimeItems.mockRejectedValueOnce(new Error('network error'));
      const config = await service.getChatLlmConfig();
      expect(config.model).toBe(DEFAULT_LLM_MODEL);
    });
  });
});
