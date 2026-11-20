import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionPermissionService } from '@/modules/account/service/session-permission.service';
import { RuntimePermissionService } from '@/modules/account/service/runtime-permission.service';
import { Logger } from '@nestjs/common';

vi.mock('@nest-cloud/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nest-cloud/sdk')>();
  return {
    ...actual,
    getConfig: vi.fn((key: string, defaultValue?: unknown, required = true) => {
      if (required && defaultValue === undefined) throw new Error(`Missing configuration: ${key}`);
      return defaultValue;
    }),
  };
});

describe('SessionPermissionService', () => {
  let service: SessionPermissionService;
  let runtimePermissionService: RuntimePermissionService;
  let accountRoleService: any;
  let roleService: any;

  beforeEach(() => {
    // 抑制 NestJS Logger 产生的 ERROR/WARN/INFO 日志
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'verbose').mockImplementation(() => {});
    runtimePermissionService = {
      getRuntimeByAccountId: vi.fn(),
    } as unknown as RuntimePermissionService;

    accountRoleService = {
      findByAccountId: vi.fn().mockResolvedValue([]),
      findAll: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      softDelete: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
      findByRoleId: vi.fn().mockResolvedValue([]),
      clearByAccountId: vi.fn().mockResolvedValue(undefined),
    } as any;

    roleService = {
      findAll: vi.fn().mockResolvedValue([]),
      getByCode: vi.fn().mockResolvedValue(null),
    };

    service = new SessionPermissionService(
      accountRoleService,
      roleService as never,
      runtimePermissionService,
    );
  });

  describe('updateAccountPermissions', () => {
    it('should skip update when session store is not available', async () => {
      await expect(service.updateAccountPermissions(1)).resolves.toBeUndefined();
    });

    it('should update session permissions when Redis is available', async () => {
      const mockRedis = {
        smembers: vi.fn().mockResolvedValue([]),
        srem: vi.fn().mockResolvedValue(0),
        sadd: vi.fn().mockResolvedValue(0),
      };

      const mockSessionStore = {
        getRedisClient: vi.fn().mockReturnValue(mockRedis),
        updateAccountPermissions: vi.fn().mockResolvedValue(1),
        updateMultipleAccountsPermissions: vi.fn().mockResolvedValue(1),
      };

      runtimePermissionService.getRuntimeByAccountId = vi.fn().mockResolvedValue({
        account: { id: 1, accountName: 'admin', displayName: '管理员' },
        roleCodes: ['admin'],
        permissionCodes: ['system:manage'],
        menuTree: [],
      });

      // @ts-expect-error - 访问私有属性用于测试
      service.sessionStore = mockSessionStore as never;

      await expect(service.updateAccountPermissions(1)).resolves.toBeUndefined();
      expect(mockSessionStore.updateAccountPermissions).toHaveBeenCalledWith(1, ['system:manage']);
    });

    it('should log error when updating session permissions fails', async () => {
      const mockRedis = {
        smembers: vi.fn().mockResolvedValue([]),
        srem: vi.fn().mockResolvedValue(0),
        sadd: vi.fn().mockResolvedValue(0),
      };

      const mockSessionStore = {
        getRedisClient: vi.fn().mockReturnValue(mockRedis),
        updateAccountPermissions: vi.fn().mockRejectedValue(new Error('Redis error')),
        updateMultipleAccountsPermissions: vi.fn().mockResolvedValue(0),
      };

      runtimePermissionService.getRuntimeByAccountId = vi.fn().mockResolvedValue({
        account: { id: 1, accountName: 'admin', displayName: '管理员' },
        roleCodes: ['admin'],
        permissionCodes: ['system:manage'],
        menuTree: [],
      });

      // @ts-expect-error - 访问私有属性用于测试
      service.sessionStore = mockSessionStore as never;

      // Should not throw, just log
      await expect(service.updateAccountPermissions(1)).resolves.toBeUndefined();
    });
  });

  describe('updateRolePermissions', () => {
    it('should skip update when session store is not available', async () => {
      await expect(service.updateRolePermissions('admin')).resolves.toBeUndefined();
    });

    it('should update all sessions for accounts with the given role', async () => {
      const mockRedis = {
        smembers: vi.fn().mockResolvedValue(['1', '2', '3']),
        srem: vi.fn().mockResolvedValue(0),
        sadd: vi.fn().mockResolvedValue(0),
      };

      const mockSessionStore = {
        getRedisClient: vi.fn().mockReturnValue(mockRedis),
        updateAccountPermissions: vi.fn().mockResolvedValue(0),
        updateMultipleAccountsPermissions: vi.fn().mockResolvedValue(2),
      };

      runtimePermissionService.getRuntimeByAccountId = vi
        .fn()
        .mockImplementation((accountId: number) =>
          Promise.resolve({
            account: {
              id: accountId,
              accountName: `user${accountId}`,
              displayName: `用户${accountId}`,
            },
            roleCodes: ['admin'],
            permissionCodes: accountId === 3 ? [] : ['system:manage'],
            menuTree: [],
          }),
        );

      // @ts-expect-error - 访问私有属性用于测试
      service.sessionStore = mockSessionStore as never;

      await expect(service.updateRolePermissions('admin')).resolves.toBeUndefined();
      expect(mockRedis.smembers).toHaveBeenCalled();
      expect(mockSessionStore.updateMultipleAccountsPermissions).toHaveBeenCalled();
    });

    it('should skip when no accounts have the role', async () => {
      const mockRedis = {
        smembers: vi.fn().mockResolvedValue([]),
        srem: vi.fn().mockResolvedValue(0),
        sadd: vi.fn().mockResolvedValue(0),
      };

      const mockSessionStore = {
        getRedisClient: vi.fn().mockReturnValue(mockRedis),
        updateAccountPermissions: vi.fn().mockResolvedValue(0),
        updateMultipleAccountsPermissions: vi.fn().mockResolvedValue(0),
      };

      // @ts-expect-error - 访问私有属性用于测试
      service.sessionStore = mockSessionStore as never;

      await expect(service.updateRolePermissions('admin')).resolves.toBeUndefined();
      expect(mockRedis.smembers).toHaveBeenCalled();
    });
  });

  describe('maintainRoleAccountIndex', () => {
    it('should skip when session store is not available', async () => {
      await expect(
        service.maintainRoleAccountIndex(1, ['viewer'], ['admin', 'viewer']),
      ).resolves.toBeUndefined();
    });

    it('should add account to new role indexes and remove from old ones', async () => {
      const mockRedis = {
        smembers: vi.fn().mockResolvedValue([]),
        srem: vi.fn().mockResolvedValue(0),
        sadd: vi.fn().mockResolvedValue(0),
      };

      const mockSessionStore = {
        getRedisClient: vi.fn().mockReturnValue(mockRedis),
        updateAccountPermissions: vi.fn().mockResolvedValue(0),
        updateMultipleAccountsPermissions: vi.fn().mockResolvedValue(0),
      };

      // @ts-expect-error - 访问私有属性用于测试
      service.sessionStore = mockSessionStore as never;

      // Old roles: ['viewer'], New roles: ['admin', 'editor']
      // 'viewer' is in old but not in new → should srem
      // 'admin' is in new but not in old → should sadd
      // 'editor' is in new but not in old → should sadd
      await expect(
        service.maintainRoleAccountIndex(1, ['viewer'], ['admin', 'editor']),
      ).resolves.toBeUndefined();

      // Should remove from 'viewer' (was old, not in new)
      expect(mockRedis.srem).toHaveBeenCalledWith(expect.anything(), '1');
      // Should add to 'admin' and 'editor' (in new, not in old)
      expect(mockRedis.sadd).toHaveBeenCalledWith(expect.anything(), '1');
    });
  });

  describe('addAccountToRoleIndex', () => {
    it('should skip when session store is not available', async () => {
      await expect(service.addAccountToRoleIndex(1, ['admin', 'editor'])).resolves.toBeUndefined();
    });
  });

  describe('removeAccountFromRoleIndex', () => {
    it('should skip when session store is not available', async () => {
      await expect(service.removeAccountFromRoleIndex(1)).resolves.toBeUndefined();
    });

    it('should skip when account has no roles', async () => {
      const mockRedis = {
        smembers: vi.fn().mockResolvedValue([]),
        srem: vi.fn().mockResolvedValue(0),
        sadd: vi.fn().mockResolvedValue(0),
      };

      const mockSessionStore = {
        getRedisClient: vi.fn().mockReturnValue(mockRedis),
        updateAccountPermissions: vi.fn().mockResolvedValue(0),
        updateMultipleAccountsPermissions: vi.fn().mockResolvedValue(0),
      };

      accountRoleService.findByAccountId = vi.fn().mockResolvedValue([]);

      // @ts-expect-error - 访问私有属性用于测试
      service.sessionStore = mockSessionStore as never;

      await expect(service.removeAccountFromRoleIndex(1)).resolves.toBeUndefined();
      expect(mockRedis.srem).not.toHaveBeenCalled();
    });

    it('should remove account from all role indexes when Redis is available', async () => {
      const mockRoles = [
        { id: 1, code: 'admin' },
        { id: 2, code: 'editor' },
      ];

      accountRoleService.findByAccountId = vi.fn().mockResolvedValue([
        { accountId: 1, roleId: 1 },
        { accountId: 1, roleId: 2 },
      ]);

      roleService.findAll = vi.fn().mockResolvedValue(mockRoles);

      const mockRedis = {
        smembers: vi.fn().mockResolvedValue([]),
        srem: vi.fn().mockResolvedValue(0),
        sadd: vi.fn().mockResolvedValue(0),
      };

      const mockSessionStore = {
        getRedisClient: vi.fn().mockReturnValue(mockRedis),
        updateAccountPermissions: vi.fn().mockResolvedValue(0),
        updateMultipleAccountsPermissions: vi.fn().mockResolvedValue(0),
      };

      // @ts-expect-error - 访问私有属性用于测试
      service.sessionStore = mockSessionStore as never;

      await expect(service.removeAccountFromRoleIndex(1)).resolves.toBeUndefined();
      expect(accountRoleService.findByAccountId).toHaveBeenCalledWith(1);
      expect(roleService.findAll).toHaveBeenCalledWith({
        where: { id: expect.anything() },
      });
      expect(mockRedis.srem).toHaveBeenCalled();
    });
  });
});
