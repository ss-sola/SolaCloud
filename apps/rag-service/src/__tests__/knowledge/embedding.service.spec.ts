import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingService } from '@/modules/knowledge/service/embedding.service';

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

vi.mock('@langchain/core/embeddings', () => ({
  Embeddings: class {},
}));

const mockEmbedQuery = vi.fn((text: string) =>
  Promise.resolve(Array.from({ length: 1536 }, (_, i) => (i + text.length) / 1536)),
);
const mockEmbedDocuments = vi.fn((texts: string[]) =>
  Promise.resolve(
    texts.map((text) => Array.from({ length: 1536 }, (_, i) => (i + text.length) / 1536)),
  ),
);

vi.mock('@langchain/openai', () => ({
  OpenAIEmbeddings: class {
    embedQuery = mockEmbedQuery;
    embedDocuments = mockEmbedDocuments;
  },
}));

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(() => {
    service = new EmbeddingService(mockRagConfigService as never);
  });

  describe('embedText', () => {
    it('should return a vector for single text', async () => {
      const result = await service.embedText('Hello world');

      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(1536);
      expect(typeof result[0]).toBe('number');
    });

    it('should return different vectors for different texts', async () => {
      const result1 = await service.embedText('Hello');
      const result2 = await service.embedText('Goodbye, this is a longer text');

      expect(result1).not.toEqual(result2);
    });

    it('should return consistent results for same text', async () => {
      const result1 = await service.embedText('Same text');
      const result2 = await service.embedText('Same text');

      expect(result1).toEqual(result2);
    });
  });

  describe('embedTexts', () => {
    it('should return vectors for multiple texts', async () => {
      const texts = ['Hello', 'World', 'Test'];
      const result = await service.embedTexts(texts);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveLength(1536);
      expect(result[1]).toHaveLength(1536);
      expect(result[2]).toHaveLength(1536);
    });

    it('should return empty array for empty input', async () => {
      const result = await service.embedTexts([]);

      expect(result).toEqual([]);
    });
  });

  describe('getDimension', () => {
    it('should return configured dimension', async () => {
      const dimension = await service.getDimension();

      expect(dimension).toBe(1536);
    });
  });

  describe('getModelName', () => {
    it('should return configured model name', async () => {
      const modelName = await service.getModelName();

      expect(modelName).toBe('text-embedding-3-small');
    });
  });
});
