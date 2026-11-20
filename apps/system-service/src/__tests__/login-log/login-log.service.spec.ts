import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { LoginLogService } from '@/modules/account/service/login-log.service';
import { LoginLogItem } from '@/modules/account/entity/login-log.entity';

describe('LoginLogService', () => {
  let service: LoginLogService;
  let mockRepo: Repository<LoginLogItem>;
  let mockDataSource: DataSource;

  beforeEach(() => {
    mockRepo = {
      findAndCount: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    } as unknown as Repository<LoginLogItem>;

    service = new LoginLogService(mockRepo as any);
  });

  it('should return overview', async () => {
    (mockRepo.count as ReturnType<typeof vi.fn>).mockResolvedValue(42);
    const overview = await service.getOverview();
    expect(overview.itemCount).toBe(42);
    expect(overview.capabilities).toContain('security-event-query');
  });

  it('should list items with filters', async () => {
    (mockRepo.findAndCount as ReturnType<typeof vi.fn>).mockResolvedValue([
      [
        {
          id: 1,
          accountId: 10,
          accountName: 'admin',
          eventType: 'login',
          success: true,
          message: 'success',
          ip: '127.0.0.1',
          userAgent: 'Chrome',
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
      1,
    ]);

    const result = await service.listItems({
      accountName: 'admin',
      eventType: 'login',
      success: true,
      pageNum: 1,
      pageSize: 10,
    });

    expect(result.list).toHaveLength(1);
    expect(result.list[0].accountName).toBe('admin');
    expect(result.total).toBe(1);
  });

  it('should log a login event', async () => {
    const createSpy = vi.spyOn(service as any, 'create').mockResolvedValue({
      id: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as LoginLogItem);

    await service.log({
      accountId: 1,
      accountName: 'admin',
      eventType: 'login',
      success: true,
      message: 'Login success',
      ip: '127.0.0.1',
      userAgent: 'Chrome',
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        accountName: 'admin',
        eventType: 'login',
        success: true,
      }),
    );
  });
});
