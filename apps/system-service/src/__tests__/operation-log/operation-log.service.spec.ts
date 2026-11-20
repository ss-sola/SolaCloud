import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { OperationLogService } from '@/modules/operation-log/service/operation-log.service';
import { OperationLogItem } from '@/modules/operation-log/entity/operation-log.entity';

describe('OperationLogService', () => {
  let service: OperationLogService;
  let mockRepo: Repository<OperationLogItem>;

  beforeEach(() => {
    mockRepo = {
      findAndCount: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    } as unknown as Repository<OperationLogItem>;

    service = new OperationLogService(mockRepo as any);
  });

  it('should return overview', async () => {
    (mockRepo.count as ReturnType<typeof vi.fn>).mockResolvedValue(100);
    const overview = await service.getOverview();
    expect(overview.itemCount).toBe(100);
    expect(overview.capabilities).toContain('list-query');
  });

  it('should list items with filters', async () => {
    (mockRepo.findAndCount as ReturnType<typeof vi.fn>).mockResolvedValue([
      [
        {
          id: 1,
          module: 'account',
          action: 'create',
          targetType: 'AccountItem',
          targetId: '1',
          summary: 'Created account admin',
          operator: 'admin',
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
      1,
    ]);

    const result = await service.listItems({
      module: 'account',
      action: 'create',
      pageNum: 1,
      pageSize: 10,
    });

    expect(result.list).toHaveLength(1);
    expect(result.list[0].module).toBe('account');
    expect(result.total).toBe(1);
  });

  it('should log an operation', async () => {
    const createSpy = vi.spyOn(service as any, 'create').mockResolvedValue({
      id: 1,
      module: 'account',
      action: 'create',
      targetType: 'AccountItem',
      targetId: '1',
      summary: 'Created account',
      operator: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as OperationLogItem);

    await service.log({
      module: 'account',
      action: 'create',
      targetType: 'AccountItem',
      targetId: '1',
      summary: 'Created account admin',
      operator: 'admin',
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'account',
        action: 'create',
        summary: 'Created account admin',
      }),
    );
  });
});
