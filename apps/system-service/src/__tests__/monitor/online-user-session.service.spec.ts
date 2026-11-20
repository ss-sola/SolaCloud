import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnlineUserSessionService } from '@/modules/monitor/service/online-user-session.service';

describe('OnlineUserSessionService', () => {
  it('should reject kick offline when redis session is not configured', async () => {
    const service = new OnlineUserSessionService();

    await expect(service.destroyBySessionId('session-1')).rejects.toThrow(
      '当前会话存储不支持踢人下线，请配置 Redis session',
    );
  });
});
