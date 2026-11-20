import { describe, it, beforeEach } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { ContextService, type AccountSessionRequest } from '@nest-cloud/sdk';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { RequirePermissions } from '@/modules/account/auth/require-permissions.decorator';

class GuardTestController {
  @RequirePermissions('system:role:manage')
  manageRoles() {
    return true;
  }

  @RequirePermissions('system:account:query', 'system:account:manage')
  manageAccounts() {
    return true;
  }

  publicEndpoint() {
    return true;
  }
}

function createExecutionContext(handlerName: keyof GuardTestController): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({}),
    }),
    getHandler: () => GuardTestController.prototype[handlerName],
    getClass: () => GuardTestController,
  } as unknown as ExecutionContext;
}

function runWithContext<T>(
  account: NonNullable<AccountSessionRequest['session']['account']>,
  fn: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    ContextService.setStore(
      {
        req: { session: { account } } as unknown as AccountSessionRequest,
        res: {} as any,
      },
      () => {
        fn().then(resolve, reject);
      },
    );
  });
}

describe('PermissionGuard (system-service)', () => {
  let guard: PermissionGuard;

  beforeEach(() => {
    guard = new PermissionGuard();
  });

  it('should allow requests when no permission metadata is declared', async () => {
    await expect(
      runWithContext(
        {
          accountId: 1,
          accountName: 'admin',
          displayName: '管理员',
          avatarUrl: undefined,
          statusVersion: 1,
          loginAt: '2026-06-19T00:00:00.000Z',
          permissionCodes: ['system:role:manage'],
        },
        () => guard.canActivate(createExecutionContext('publicEndpoint')),
      ),
    ).resolves.toBe(true);
  });

  it('should allow requests when user has required permissions', async () => {
    await expect(
      runWithContext(
        {
          accountId: 1,
          accountName: 'admin',
          displayName: '管理员',
          avatarUrl: undefined,
          statusVersion: 1,
          loginAt: '2026-06-19T00:00:00.000Z',
          permissionCodes: ['system:role:manage', 'system:role:query'],
        },
        () => guard.canActivate(createExecutionContext('manageRoles')),
      ),
    ).resolves.toBe(true);
  });

  it('should allow requests when user has all required permissions', async () => {
    await expect(
      runWithContext(
        {
          accountId: 1,
          accountName: 'admin',
          displayName: '管理员',
          avatarUrl: undefined,
          statusVersion: 1,
          loginAt: '2026-06-19T00:00:00.000Z',
          permissionCodes: ['system:account:query', 'system:account:manage', 'system:role:query'],
        },
        () => guard.canActivate(createExecutionContext('manageAccounts')),
      ),
    ).resolves.toBe(true);
  });

  it('should reject requests when user lacks required permissions', async () => {
    await expect(
      runWithContext(
        {
          accountId: 1,
          accountName: 'viewer',
          displayName: '查看者',
          avatarUrl: undefined,
          statusVersion: 1,
          loginAt: '2026-06-19T00:00:00.000Z',
          permissionCodes: ['system:role:query'],
        },
        () => guard.canActivate(createExecutionContext('manageRoles')),
      ),
    ).rejects.toThrow('缺少权限：system:role:manage');
  });

  it('should reject requests when permissionCodes is missing from session', async () => {
    await expect(
      runWithContext(
        {
          accountId: 1,
          accountName: 'admin',
          displayName: '管理员',
          avatarUrl: undefined,
          statusVersion: 1,
          loginAt: '2026-06-19T00:00:00.000Z',
        } as never,
        () => guard.canActivate(createExecutionContext('manageRoles')),
      ),
    ).rejects.toThrow('无权限信息，请重新登录');
  });

  it('should reject requests when permissionCodes is empty', async () => {
    await expect(
      runWithContext(
        {
          accountId: 1,
          accountName: 'admin',
          displayName: '管理员',
          avatarUrl: undefined,
          statusVersion: 1,
          loginAt: '2026-06-19T00:00:00.000Z',
          permissionCodes: [],
        },
        () => guard.canActivate(createExecutionContext('manageRoles')),
      ),
    ).rejects.toThrow('无权限信息，请重新登录');
  });

  it('should reject requests when session is missing', async () => {
    const guard2 = new PermissionGuard();
    // Set ALs context but with no account in session
    await expect(
      new Promise((resolve) => {
        ContextService.setStore(
          {
            req: { session: {} } as any,
            res: {} as any,
          },
          async () => {
            try {
              await guard2.canActivate(createExecutionContext('manageRoles'));
              resolve(null);
            } catch (e) {
              resolve(e);
            }
          },
        );
      }),
    ).resolves.toMatchObject({ message: '请先登录' });
  });
});
