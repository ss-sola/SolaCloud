import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { KnowledgeBaseService } from '../../../src/modules/knowledge/service/knowledge-base.service';
import { KnowledgeBase } from '../../../src/modules/knowledge/entity/knowledge-base.entity';
import { KNOWLEDGE_BASE_STATUS } from '../../../src/modules/knowledge/knowledge.constants';

describe('KnowledgeBaseService', () => {
  let service: KnowledgeBaseService;
  let mockRepo: Repository<KnowledgeBase>;
  let mockFindOneBy: ReturnType<typeof vi.fn>;
  let mockFind: ReturnType<typeof vi.fn>;
  let mockQb: ReturnType<typeof vi.fn>;
  let mockQbInstance: {
    where: ReturnType<typeof vi.fn>;
    andWhere: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    getMany: ReturnType<typeof vi.fn>;
  };

  const createMockKb = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase =>
    ({
      id: 1,
      name: 'Test KB',
      status: KNOWLEDGE_BASE_STATUS.Active,
      ...overrides,
    }) as unknown as KnowledgeBase;

  beforeEach(() => {
    mockFindOneBy = vi.fn();
    mockFind = vi.fn();
    mockQb = vi.fn();

    mockQbInstance = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };

    mockQb.mockReturnValue(mockQbInstance);

    mockRepo = {
      findOneBy: mockFindOneBy,
      find: mockFind,
      createQueryBuilder: mockQb,
    } as unknown as Repository<KnowledgeBase>;

    service = new KnowledgeBaseService(mockRepo as any);
  });

  describe('findByStatus', () => {
    it('should return knowledge bases with given status', async () => {
      mockFind.mockResolvedValue([createMockKb()]);

      const result = await service.findByStatus(KNOWLEDGE_BASE_STATUS.Active);

      expect(result).toHaveLength(1);
      expect(mockFind).toHaveBeenCalledWith({ where: { status: KNOWLEDGE_BASE_STATUS.Active } });
    });
  });

  describe('listAccessible', () => {
    it('should return all non-deleted knowledge bases', async () => {
      mockQbInstance.getMany.mockResolvedValue([createMockKb()]);

      const result = await service.listAccessible(100);

      expect(mockQb).toHaveBeenCalledWith('kb');
      expect(mockQbInstance.where).toHaveBeenCalledWith('kb.deleted_at IS NULL');
      expect(result).toHaveLength(1);
    });
  });

  describe('listAccessibleWithOptions', () => {
    it('should return all knowledge bases when no options provided', async () => {
      mockQbInstance.getMany.mockResolvedValue([createMockKb()]);

      const result = await service.listAccessibleWithOptions({});

      expect(mockQb).toHaveBeenCalledWith('kb');
      expect(mockQbInstance.where).toHaveBeenCalledWith('kb.deleted_at IS NULL');
      expect(result).toHaveLength(1);
    });

    it('should filter by status when provided', async () => {
      mockQbInstance.getMany.mockResolvedValue([]);

      await service.listAccessibleWithOptions({ status: KNOWLEDGE_BASE_STATUS.Archived });

      expect(mockQbInstance.andWhere).toHaveBeenCalledWith('kb.status = :status', {
        status: KNOWLEDGE_BASE_STATUS.Archived,
      });
    });
  });
});
