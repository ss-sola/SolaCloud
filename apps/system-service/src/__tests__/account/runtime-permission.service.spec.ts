import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { RuntimePermissionService } from '@/modules/account/service/runtime-permission.service';
import { AccountRoleItem } from '@/modules/account/entity/account-role.entity';
import { AccountItem } from '@/modules/account/entity/account.entity';
import { MenuRouteItem } from '@/modules/menu-route/entity/menu-route.entity';
import { MenuRoutePermissionItem } from '@/modules/menu-route/entity/menu-route-permission.entity';
import { PermissionItem } from '@/modules/permission/entity/permission.entity';
import { RolePermissionItem } from '@/modules/role/entity/role-permission.entity';
import { RoleItem } from '@/modules/role/entity/role.entity';

type MockRepository<T extends object> = Partial<Record<keyof Repository<T>, any>>;

function createService(permissionCodes: string[]) {
  /** All permission definitions that exist in the system */
  const allPermissions = [
    { id: 1, code: 'system:login-log:query', isEnabled: true },
    { id: 2, code: 'system:operation-log:query', isEnabled: true },
  ] as PermissionItem[];

  const accountRepository: MockRepository<AccountItem> = {
    findOne: vi.fn(() =>
      Promise.resolve({
        id: 1,
        accountName: 'audit-reader',
        displayName: '审计员',
        avatarUrl: null,
        isEnabled: true,
      } as AccountItem),
    ),
  };

  const accountRoleRepository: MockRepository<AccountRoleItem> = {
    find: vi.fn(() =>
      Promise.resolve([
        {
          accountId: 1,
          roleId: 11,
        } as AccountRoleItem,
      ]),
    ),
  };

  const roleRepository: MockRepository<RoleItem> = {
    find: vi.fn(() =>
      Promise.resolve([
        {
          id: 11,
          code: 'audit-reader',
          isEnabled: true,
        } as RoleItem,
      ]),
    ),
  };

  const rolePermissionRepository: MockRepository<RolePermissionItem> = {
    find: vi.fn(() =>
      Promise.resolve(
        permissionCodes.map(
          (_code, index) =>
            ({
              roleId: 11,
              permissionId: index + 1,
            }) as RolePermissionItem,
        ),
      ),
    ),
  };

  const permissionRepository: MockRepository<PermissionItem> = {
    find: vi.fn(({ where }: { where?: Record<string, unknown> }) => {
      let results = [...allPermissions];
      if (where) {
        if (where.id && typeof where.id === 'object' && '_type' in where.id) {
          const marker = where.id as { _type: string; _value: number[] };
          if (marker._type === 'in') {
            results = results.filter((p) => marker._value.includes(p.id));
          }
        }
        if (where.isEnabled !== undefined) {
          results = results.filter((p) => p.isEnabled === where.isEnabled);
        }
      }
      // Filter to only return permissions the user actually has (for getPermissionCodes)
      // But if query is just by id (for code resolution), return all matching
      if (where?.id) {
        return Promise.resolve(results);
      }
      // This is called from getPermissionCodes with { id: In(permissionIds), isEnabled: true }
      return Promise.resolve(results);
    }),
  };

  const menuRouteRepository: MockRepository<MenuRouteItem> = {
    find: vi.fn(() =>
      Promise.resolve([
        {
          id: 201,
          code: 'system-observe-group',
          name: '运行与审计',
          routeName: null,
          parentId: null,
          redirect: null,
          icon: 'system-observe-group',
          sort: 2,
          isEnabled: true,
          isGroup: true,
          hideHeader: false,
          hideRoute: false,
          routeRoot: 'system',
          createdAt: new Date('2026-06-08T00:00:00.000Z'),
          updatedAt: new Date('2026-06-08T00:00:00.000Z'),
        } as MenuRouteItem,
        {
          id: 202,
          code: 'login-log',
          name: '登录日志',
          routeName: 'login-log',
          parentId: 201,
          redirect: null,
          icon: 'login-log',
          sort: 1,
          isEnabled: true,
          isGroup: false,
          hideHeader: true,
          hideRoute: false,
          routeRoot: null,
          createdAt: new Date('2026-06-08T00:00:00.000Z'),
          updatedAt: new Date('2026-06-08T00:00:00.000Z'),
        } as MenuRouteItem,
        {
          id: 203,
          code: 'operation-log',
          name: '操作日志',
          routeName: 'operation-log',
          parentId: 201,
          redirect: null,
          icon: 'operation-log',
          sort: 2,
          isEnabled: true,
          isGroup: false,
          hideHeader: true,
          hideRoute: true,
          routeRoot: null,
          createdAt: new Date('2026-06-08T00:00:00.000Z'),
          updatedAt: new Date('2026-06-08T00:00:00.000Z'),
        } as MenuRouteItem,
      ]),
    ),
  };

  const menuRoutePermissionRepository: MockRepository<MenuRoutePermissionItem> = {
    find: vi.fn(() =>
      Promise.resolve([
        {
          id: 1,
          menuRouteId: 201,
          permissionId: 1,
        } as MenuRoutePermissionItem,
        {
          id: 2,
          menuRouteId: 202,
          permissionId: 1,
        } as MenuRoutePermissionItem,
        {
          id: 3,
          menuRouteId: 203,
          permissionId: 2,
        } as MenuRoutePermissionItem,
      ]),
    ),
  };

  const repositoryMap = new Map<object, object>([
    [AccountItem, accountRepository],
    [AccountRoleItem, accountRoleRepository],
    [RoleItem, roleRepository],
    [RolePermissionItem, rolePermissionRepository],
    [PermissionItem, permissionRepository],
    [MenuRouteItem, menuRouteRepository],
    [MenuRoutePermissionItem, menuRoutePermissionRepository],
  ]);

  const dataSource = {
    getRepository: vi.fn((entity: object) => repositoryMap.get(entity)),
  } as unknown as DataSource;

  return new RuntimePermissionService(dataSource);
}

describe('RuntimePermissionService', () => {
  let service: RuntimePermissionService;

  beforeEach(() => {
    service = createService(['system:login-log:query', 'system:operation-log:query']);
  });

  it('should expose audit menu routes when account has related permissions', async () => {
    const runtime = await service.getRuntimeByAccountId(1);

    expect(runtime.permissionCodes).toEqual(
      expect.arrayContaining(['system:login-log:query', 'system:operation-log:query']),
    );
    expect(runtime.menuTree.map((item) => item.code)).toEqual(['system-observe-group']);
    expect(runtime.menuTree[0].children.map((item) => item.code)).toEqual([
      'login-log',
      'operation-log',
    ]);
    expect(
      runtime.menuTree[0].children.filter((item) => item.hideRoute).map((item) => item.code),
    ).toEqual(['operation-log']);
  });

  it('should hide audit routes when related permissions are missing', async () => {
    const restrictedService = createService([]);

    const runtime = await restrictedService.getRuntimeByAccountId(1);

    expect(runtime.menuTree).toEqual([]);
  });
});
