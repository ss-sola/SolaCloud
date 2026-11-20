import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnlineUserService } from '@/modules/monitor/service/online-user.service';
import { OnlineUserSessionService } from '@/modules/monitor/service/online-user-session.service';

function createSessionService() {
  return {
    destroyBySessionId: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as OnlineUserSessionService;
}

describe('OnlineUserService', () => {
  let service: OnlineUserService;
  let sessionService: OnlineUserSessionService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T08:00:00.000Z'));
    sessionService = createSessionService();
    service = new OnlineUserService(sessionService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should upsert online user and list by recent activity', () => {
    service.upsert({
      sessionId: 'session-1',
      accountId: 1,
      accountName: 'admin',
      displayName: '系统管理员',
      avatarUrl: 'https://example.com/avatar.png',
      sessionLoginAt: '2026-05-31T07:59:00.000Z',
      ip: '127.0.0.1',
      userAgent: ['jest', 'agent'],
    });

    const result = service.listItems({ pageNum: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.list[0]).toMatchObject({
      sessionId: 'session-1',
      accountId: 1,
      accountName: 'admin',
      displayName: '系统管理员',
      avatarUrl: 'https://example.com/avatar.png',
      ip: '127.0.0.1',
      userAgent: 'jest agent',
      loginAt: '2026-05-31T07:59:00.000Z',
      lastActiveAt: '2026-05-31T08:00:00.000Z',
    });
  });

  it('should filter, paginate, remove and prune online users', () => {
    service.upsert({
      sessionId: 'session-1',
      accountId: 1,
      accountName: 'admin',
      displayName: '系统管理员',
      ip: '10.0.0.1',
    });
    vi.setSystemTime(new Date('2026-05-31T08:01:00.000Z'));
    service.upsert({
      sessionId: 'session-2',
      accountId: 2,
      accountName: 'auditor',
      displayName: '审计员',
      ip: '10.0.0.2',
    });

    const filtered = service.listItems({
      pageNum: 1,
      pageSize: 1,
      keyword: 'audit',
    });

    expect(filtered.total).toBe(1);
    expect(filtered.list[0]?.sessionId).toBe('session-2');

    service.removeBySessionId('session-2');
    expect(service.getOverview().onlineUserCount).toBe(1);

    vi.setSystemTime(new Date('2026-06-01T08:00:00.000Z'));
    expect(service.listItems({ pageNum: 1, pageSize: 10 }).total).toBe(0);
  });

  it('should destroy target session before removing online user', async () => {
    service.upsert({
      sessionId: 'operator-session',
      accountId: 1,
      accountName: 'admin',
      displayName: '系统管理员',
    });
    service.upsert({
      sessionId: 'target-session',
      accountId: 2,
      accountName: 'auditor',
      displayName: '审计员',
    });

    const result = await service.kickOffline({
      sessionId: 'target-session',
      operatorSessionId: 'operator-session',
    });

    expect(result).toEqual({ sessionId: 'target-session', kicked: true });
    expect(sessionService.destroyBySessionId).toHaveBeenCalledWith('target-session');
    expect(service.listItems({ pageNum: 1, pageSize: 10 }).list).toHaveLength(1);
  });

  it('should reject unknown or current session kick requests', async () => {
    service.upsert({
      sessionId: 'operator-session',
      accountId: 1,
      accountName: 'admin',
      displayName: '系统管理员',
    });

    await expect(
      service.kickOffline({
        sessionId: 'missing-session',
        operatorSessionId: 'operator-session',
      }),
    ).rejects.toThrow('在线用户会话不存在或已过期');

    await expect(
      service.kickOffline({
        sessionId: 'operator-session',
        operatorSessionId: 'operator-session',
      }),
    ).rejects.toThrow('不能踢出当前登录会话');
    expect(sessionService.destroyBySessionId).not.toHaveBeenCalled();
  });

  it('should keep online record when session destroy fails', async () => {
    (sessionService.destroyBySessionId as any).mockRejectedValueOnce(
      new Error('redis unavailable'),
    );
    service.upsert({
      sessionId: 'target-session',
      accountId: 2,
      accountName: 'auditor',
      displayName: '审计员',
    });

    await expect(
      service.kickOffline({
        sessionId: 'target-session',
        operatorSessionId: 'operator-session',
      }),
    ).rejects.toThrow('redis unavailable');

    expect(service.listItems({ pageNum: 1, pageSize: 10 }).list).toHaveLength(1);
  });
});
