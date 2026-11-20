import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { ContextService, type AccountSessionRequest } from '@nest-cloud/sdk';
import { AccountItem } from '@/modules/account/entity/account.entity';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import {
  REQUIRED_PERMISSION_CODES_KEY,
  REQUIRED_PERMISSION_MATCH_MODE_KEY,
} from '@/modules/account/auth/require-permissions.decorator';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';

function createContext(params: {
  request: any;
  handler?: () => void;
  controller?: object;
}): ExecutionContext {
  const handler = params.handler ?? (() => undefined);
  const controller = params.controller ?? class TestController {};
  return {
    switchToHttp: () => ({
      getRequest: () => params.request,
    }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

function createAccount(id: number): AccountItem {
  return {
    id,
    accountName: `account-${id}`,
    displayName: `Account ${id}`,
    passwordHash: 'hash',
    isEnabled: true,
    failedLoginCount: 0,
    statusVersion: 1,
    createdAt: new Date('2026-05-29T00:00:00.000Z'),
    updatedAt: new Date('2026-05-29T00:00:00.000Z'),
  } as AccountItem;
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

describe('auth guards', () => {
  it('should reject management requests without a session account', async () => {
    const guard = new SessionAuthGuard();

    expect(() => guard.canActivate(createContext({ request: { session: {} } }))).toThrow(
      '请先登录',
    );
  });

  it('should allow session requests without mutating current account', async () => {
    const request: any = {
      session: {
        account: {
          accountId: 7,
          accountName: 'account-7',
          displayName: 'Account 7',
          statusVersion: 1,
          loginAt: '2026-05-29T00:00:00.000Z',
        },
      },
    };
    const guard = new SessionAuthGuard();

    expect(guard.canActivate(createContext({ request }))).toBe(true);
    expect(request.currentAccount).toBeUndefined();
  });

  it('should allow requests only when required permissions are present', async () => {
    const handler = () => undefined;
    Reflect.defineMetadata(REQUIRED_PERMISSION_CODES_KEY, ['system:role:manage'], handler);
    const guard = new PermissionGuard();

    await expect(
      runWithContext(
        {
          accountId: 3,
          accountName: 'admin',
          displayName: 'Admin',
          statusVersion: 1,
          loginAt: '2026-06-19T00:00:00.000Z',
          permissionCodes: ['system:role:manage', 'system:role:query'],
        },
        () =>
          guard.canActivate(
            createContext({
              request: {
                currentAccount: createAccount(3),
                session: {
                  account: {
                    accountId: 3,
                    accountName: 'admin',
                    displayName: 'Admin',
                    statusVersion: 1,
                    loginAt: '2026-06-19T00:00:00.000Z',
                    permissionCodes: ['system:role:manage', 'system:role:query'],
                  },
                },
              },
              handler,
            }),
          ),
      ),
    ).resolves.toBe(true);
  });

  it('should allow any-permission requests when one permission is present', async () => {
    const handler = () => undefined;
    Reflect.defineMetadata(
      REQUIRED_PERMISSION_CODES_KEY,
      ['system:role:manage', 'system:account:manage'],
      handler,
    );
    Reflect.defineMetadata(REQUIRED_PERMISSION_MATCH_MODE_KEY, 'any', handler);
    const guard = new PermissionGuard();

    await expect(
      runWithContext(
        {
          accountId: 3,
          accountName: 'admin',
          displayName: 'Admin',
          statusVersion: 1,
          loginAt: '2026-06-19T00:00:00.000Z',
          permissionCodes: ['system:account:manage'],
        },
        () =>
          guard.canActivate(
            createContext({
              request: {
                currentAccount: createAccount(3),
                session: {
                  account: {
                    accountId: 3,
                    accountName: 'admin',
                    displayName: 'Admin',
                    statusVersion: 1,
                    loginAt: '2026-06-19T00:00:00.000Z',
                    permissionCodes: ['system:account:manage'],
                  },
                },
              },
              handler,
            }),
          ),
      ),
    ).resolves.toBe(true);
  });

  it('should reject requests missing required permissions', async () => {
    const handler = () => undefined;
    Reflect.defineMetadata(REQUIRED_PERMISSION_CODES_KEY, ['system:role:manage'], handler);
    const guard = new PermissionGuard();

    await expect(
      runWithContext(
        {
          accountId: 3,
          accountName: 'viewer',
          displayName: 'Viewer',
          statusVersion: 1,
          loginAt: '2026-06-19T00:00:00.000Z',
          permissionCodes: ['system:role:query'],
        },
        () =>
          guard.canActivate(
            createContext({
              request: {
                currentAccount: createAccount(3),
                session: {
                  account: {
                    accountId: 3,
                    accountName: 'viewer',
                    displayName: 'Viewer',
                    statusVersion: 1,
                    loginAt: '2026-06-19T00:00:00.000Z',
                    permissionCodes: ['system:role:query'],
                  },
                },
              },
              handler,
            }),
          ),
      ),
    ).rejects.toThrow('缺少权限：system:role:manage');
  });
});
