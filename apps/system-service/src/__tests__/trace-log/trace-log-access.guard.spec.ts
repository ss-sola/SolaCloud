import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AccountService } from '@/modules/account/service/account.service';
import type { RuntimePermissionService } from '@/modules/account/service/runtime-permission.service';
import { TraceLogAccessGuard } from '@/modules/trace-log/trace-log-access.guard';

const session = { accountId: 7, statusVersion: 1, permissionCodes: ['system:trace-log:query'] };

function setup() {
  const validateSession = vi.fn();
  const hasCurrentPermission = vi.fn();
  const guard = new TraceLogAccessGuard(
    { validateSession } as unknown as AccountService,
    { hasCurrentPermission } as unknown as RuntimePermissionService,
  );
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ session: { account: session } }) }),
  } as unknown as ExecutionContext;
  return { guard, context, validateSession, hasCurrentPermission };
}

describe('TraceLogAccessGuard', () => {
  it('refuses revoked grants even when the session snapshot still contains the permission', async () => {
    const { guard, context, validateSession, hasCurrentPermission } = setup();
    validateSession.mockResolvedValue({ id: 7 });
    hasCurrentPermission.mockResolvedValue(false);
    await expect(guard.canActivate(context)).rejects.toThrow('缺少集中日志查询权限');
    expect(hasCurrentPermission).toHaveBeenCalledWith(7, 'system:trace-log:query');
  });

  it('refuses an expired session before evaluating grants', async () => {
    const { guard, context, validateSession, hasCurrentPermission } = setup();
    validateSession.mockRejectedValue(new Error('Account session expired'));
    await expect(guard.canActivate(context)).rejects.toThrow('Account session expired');
    expect(hasCurrentPermission).not.toHaveBeenCalled();
  });
});
