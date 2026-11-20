import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { RuntimePermissionService } from '@/modules/account/service/runtime-permission.service';
import { MenuRouteItem } from '@/modules/menu-route/entity/menu-route.entity';
import { MenuRoutePermissionItem } from '@/modules/menu-route/entity/menu-route-permission.entity';
import { OperationLogService } from '@/modules/operation-log/service/operation-log.service';
import { PermissionItem } from '@/modules/permission/entity/permission.entity';
import { PermissionService } from '@/modules/permission/service/permission.service';
import { RoleItem } from '@/modules/role/entity/role.entity';
import { RolePermissionItem } from '@/modules/role/entity/role-permission.entity';
import { RolePermissionService } from '@/modules/role/service/role-permission.service';
import { RoleService } from '@/modules/role/service/role.service';
import { MenuRoutePermissionService } from '@/modules/menu-route/service/menu-route-permission.service';
import { RoleQueryForm } from '@/modules/role/form/role-query.form';

type MockRepository<T extends object> = Partial<Record<keyof Repository<T>, any>>;

type RoleServiceContext = ReturnType<typeof createService>;

function createService() {
  const roleItems = new Map<number, RoleItem>();
  const rolePermissionRelations: RolePermissionItem[] = [];
  const menuRouteItems = new Map<number, MenuRouteItem>();
  const menuRoutePermissionRelations: MenuRoutePermissionItem[] = [];
  const permissionItems = new Map<number, PermissionItem>();

  let roleSequence = 1;
  let relationSequence = 1;

  const roleRepository: MockRepository<RoleItem> = {
    count: vi.fn(() => Promise.resolve(roleItems.size)),
    findAndCount: vi.fn(
      ({
        where,
        skip = 0,
        take = 10,
      }: {
        where?: Record<string, unknown>;
        skip?: number;
        take?: number;
      }) => {
        let values = [...roleItems.values()];
        if (where) {
          const whereList = Array.isArray(where) ? where : [where];
          values = values.filter((item) => whereList.some((w) => matchesWhere(item, w)));
        }
        return Promise.resolve([values.slice(skip, skip + take), values.length]);
      },
    ),
    findOne: vi.fn(({ where }: { where: { id?: number; code?: string } }) => {
      if (where.id !== undefined) {
        return Promise.resolve(roleItems.get(where.id) ?? null);
      }
      return Promise.resolve(
        [...roleItems.values()].find((item) => item.code === where.code) ?? null,
      );
    }),
    find: vi.fn((options?: { where?: Record<string, unknown> }) => {
      let values = [...roleItems.values()];
      if (options?.where) {
        values = values.filter((item) => matchesWhere(item, options.where!));
      }
      return Promise.resolve(values.sort((left, right) => left.id - right.id));
    }),
    create: vi.fn((input: Partial<RoleItem>) => createRoleItem(input, roleSequence)),
    save: vi.fn((entity: RoleItem) => {
      if (!entity.id) {
        entity.id = roleSequence;
      }
      if (entity.id === roleSequence) {
        roleSequence += 1;
      }
      entity.updatedAt = new Date('2026-05-28T00:00:00.000Z');
      roleItems.set(entity.id, entity);
      return Promise.resolve(entity);
    }),
    remove: vi.fn((entity: RoleItem) => {
      roleItems.delete(entity.id);
      return Promise.resolve(entity);
    }),
    update: vi.fn((id: number, data: Partial<RoleItem>) => {
      const item = roleItems.get(id);
      if (item) {
        Object.assign(item, data);
        item.id = id;
      }
      return Promise.resolve({ affected: item ? 1 : 0 } as any);
    }),
    softDelete: vi.fn((id: number) => {
      roleItems.delete(id);
      return Promise.resolve({ affected: 1 } as any);
    }),
  };

  const rolePermissionRepository: MockRepository<RolePermissionItem> = {
    create: vi.fn(
      (input: Partial<RolePermissionItem>) =>
        ({
          id: relationSequence++,
          roleId: input.roleId ?? 0,
          permissionId: input.permissionId ?? 0,
        }) as RolePermissionItem,
    ),
    save: vi.fn((entity: RolePermissionItem) => {
      rolePermissionRelations.push(entity);
      return Promise.resolve(entity);
    }),
    delete: vi.fn((criteria: { roleId?: number }) => {
      removeRelations(rolePermissionRelations, criteria);
      return Promise.resolve(undefined);
    }),
    find: vi.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(filterItems(rolePermissionRelations, options?.where)),
    ),
  };

  const menuRouteRepository: MockRepository<MenuRouteItem> = {
    find: vi.fn((options?: { where?: Record<string, unknown> }) => {
      let values = [...menuRouteItems.values()];
      if (options?.where) {
        values = values.filter((item) => matchesWhere(item, options.where!));
      }
      return Promise.resolve(
        values.sort(
          (left, right) =>
            (left.parentId ?? 0) - (right.parentId ?? 0) ||
            left.sort - right.sort ||
            left.id - right.id,
        ),
      );
    }),
    findOne: vi.fn(({ where }: { where: { id?: number; isEnabled?: boolean } }) => {
      if (where.id !== undefined) {
        return Promise.resolve(menuRouteItems.get(where.id) ?? null);
      }
      if (where.isEnabled !== undefined) {
        return Promise.resolve(
          [...menuRouteItems.values()]
            .filter((i) => i.isEnabled)
            .sort(
              (a, b) => (a.parentId ?? 0) - (b.parentId ?? 0) || a.sort - b.sort || a.id - b.id,
            ),
        );
      }
      return Promise.resolve(null);
    }),
  };

  const menuRoutePermissionRepository: MockRepository<MenuRoutePermissionItem> = {
    find: vi.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(filterItems(menuRoutePermissionRelations, options?.where)),
    ),
  };

  const permissionRepository: MockRepository<PermissionItem> = {
    find: vi.fn((options?: { where?: Record<string, unknown> }) => {
      let values = [...permissionItems.values()];
      if (options?.where) {
        values = values.filter((item) => matchesWhere(item, options.where!));
      }
      return Promise.resolve(values.sort((left, right) => left.id - right.id));
    }),
  };

  const permissionService: Partial<PermissionService> = {
    assertCodesExist: vi.fn(async () => {}),
    assertCodesDefined: vi.fn(async () => {}),
    getIdsByCodes: vi.fn(async (codes: string[]) => {
      return codes
        .map((c) => {
          const p = [...permissionItems.values()].find((item) => item.code === c);
          return p?.id;
        })
        .filter((id): id is number => id !== undefined);
    }),
    getCodesByIds: vi.fn(async (ids: number[]) => {
      const map = new Map<number, string>();
      ids.forEach((id) => {
        const p = permissionItems.get(id);
        if (p) map.set(id, p.code);
      });
      return map;
    }),
    findByIds: vi.fn(async (ids: number[], _onlyEnabled?: boolean) => {
      return ids
        .map((id) => permissionItems.get(id))
        .filter((p): p is PermissionItem => p !== undefined && (!_onlyEnabled || p.isEnabled));
    }),
    findByCodes: vi.fn(async (codes: string[]) => {
      return codes
        .map((c) => [...permissionItems.values()].find((item) => item.code === c))
        .filter((p): p is PermissionItem => p !== undefined);
    }),
  };

  const rolePermissionService = {
    clearByRoleId: vi.fn(async (roleId: number) => {
      removeRelations(rolePermissionRelations, { roleId });
    }),
    create: vi.fn((data: Partial<RolePermissionItem>) => {
      const entity = {
        id: relationSequence++,
        roleId: data.roleId,
        permissionId: data.permissionId,
      } as RolePermissionItem;
      rolePermissionRelations.push(entity);
      return Promise.resolve(entity);
    }),
  } as unknown as RolePermissionService;

  const menuRoutePermissionService = {
    findByMenuRouteId: vi.fn(async (menuRouteId: number) => {
      return menuRoutePermissionRelations.filter((r) => r.menuRouteId === menuRouteId);
    }),
    findByMenuRouteIds: vi.fn(async (ids: number[]) => {
      if (!ids.length) return [];
      return menuRoutePermissionRelations.filter((r) => ids.includes(r.menuRouteId));
    }),
    clearByMenuRouteId: vi.fn(async (menuRouteId: number) => {
      removeRelations(menuRoutePermissionRelations, { menuRouteId });
    }),
    create: vi.fn((input: Partial<MenuRoutePermissionItem>) => {
      const entity = {
        ...input,
        id: input.id ?? ++relationSequence,
        menuRouteId: input.menuRouteId ?? 0,
        permissionId: input.permissionId ?? 0,
      } as MenuRoutePermissionItem;
      menuRoutePermissionRelations.push(entity);
      return Promise.resolve(entity);
    }),
  } as unknown as MenuRoutePermissionService;

  const dataSource = {
    getRepository: vi.fn((entityClass: any) => {
      if (entityClass === RolePermissionItem)
        return rolePermissionRepository as unknown as Repository<RolePermissionItem>;
      return roleRepository as unknown as Repository<RoleItem>;
    }),
  } as unknown as DataSource;

  const operationLogService = {
    log: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as OperationLogService;
  const runtimePermissionService = {
    invalidateAll: vi.fn(),
  } as unknown as RuntimePermissionService;

  const sessionPermissionService = {
    updateRolePermissions: vi.fn(),
  };

  return {
    service: new RoleService(
      roleRepository as unknown as Repository<RoleItem>,
      dataSource,
      rolePermissionService,
      menuRoutePermissionService,
      menuRouteRepository as unknown as Repository<MenuRouteItem>,
      permissionService as PermissionService,
      operationLogService,
      runtimePermissionService,
      sessionPermissionService as never,
    ),
    permissionService: permissionService as PermissionService,
    runtimePermissionService,
    stores: {
      roleItems,
      rolePermissionRelations,
      menuRouteItems,
      menuRoutePermissionRelations,
      permissionItems,
    },
  };
}

function createRoleItem(input: Partial<RoleItem>, id: number): RoleItem {
  return {
    id: input.id ?? id,
    code: input.code ?? '',
    name: input.name ?? '',
    description: input.description ?? null,
    isEnabled: input.isEnabled ?? true,
    createdAt: new Date('2026-05-28T00:00:00.000Z'),
    updatedAt: new Date('2026-05-28T00:00:00.000Z'),
  } as RoleItem;
}

function removeRelations<T extends object>(items: T[], criteria: Record<string, unknown>) {
  const remaining = items.filter((item) => !matchesWhere(item, criteria));
  items.splice(0, items.length, ...remaining);
}

function filterItems<T extends object>(items: T[], where?: Record<string, unknown>) {
  if (!where) {
    return [...items];
  }
  return items.filter((item) => matchesWhere(item, where));
}

function matchesWhere(item: object, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    const current = (item as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && '_type' in value) {
      const marker = value as { _type?: string; _value?: unknown };
      if (marker._type === 'ilike') {
        const keyword = String(marker._value ?? '')
          .replaceAll('%', '')
          .toLowerCase();
        return String(current ?? '')
          .toLowerCase()
          .includes(keyword);
      }
      if (marker._type === 'in' && Array.isArray(marker._value)) {
        return marker._value.includes(current);
      }
    }
    return current === value;
  });
}

function seedPermission(
  context: RoleServiceContext,
  input: Partial<PermissionItem> & { id: number; code: string },
) {
  context.stores.permissionItems.set(input.id, {
    id: input.id,
    code: input.code,
    name: input.name ?? input.code,
    groupKey: input.groupKey ?? 'system',
    description: input.description ?? null,
    isEnabled: input.isEnabled ?? true,
    createdAt: new Date('2026-05-28T00:00:00.000Z'),
    updatedAt: new Date('2026-05-28T00:00:00.000Z'),
  } as PermissionItem);
}

function seedDefaultPermissions(
  context: RoleServiceContext,
  overrides: Partial<Record<string, Partial<PermissionItem>>> = {},
) {
  DEFAULT_PERMISSION_DATA.forEach((item, index) => {
    seedPermission(context, {
      id: index + 1,
      code: item.code,
      name: item.name,
      groupKey: item.groupKey,
      description: item.description,
      isEnabled: item.isEnabled,
      ...overrides[item.code],
    });
  });
}

function seedMenuRoute(
  context: RoleServiceContext,
  input: Partial<MenuRouteItem> & {
    id: number;
    code: string;
    name: string;
  },
) {
  context.stores.menuRouteItems.set(input.id, {
    id: input.id,
    code: input.code,
    name: input.name,
    routeName: input.routeName ?? null,
    parentId: input.parentId ?? null,
    redirect: input.redirect ?? null,
    icon: input.icon ?? null,
    sort: input.sort ?? 0,
    isEnabled: input.isEnabled ?? true,
    isGroup: input.isGroup ?? false,
    hideHeader: input.hideHeader ?? false,
    hideRoute: input.hideRoute ?? false,
    routeRoot: input.routeRoot ?? null,
    createdAt: new Date('2026-05-28T00:00:00.000Z'),
    updatedAt: new Date('2026-05-28T00:00:00.000Z'),
  } as MenuRouteItem);
}

function seedMenuRoutePermission(
  context: RoleServiceContext,
  menuRouteId: number,
  permissionCodes: string[],
) {
  for (const permissionCode of permissionCodes) {
    const permission = [...context.stores.permissionItems.values()].find(
      (p) => p.code === permissionCode,
    );
    if (permission) {
      context.stores.menuRoutePermissionRelations.push({
        id: context.stores.menuRoutePermissionRelations.length + 1,
        menuRouteId,
        permissionId: permission.id,
      } as MenuRoutePermissionItem);
    }
  }
}

describe('RoleService', () => {
  let context: RoleServiceContext;

  beforeEach(() => {
    context = createService();
  });

  it('should expose role permission bindings and derive runtime menu tree from permissions', async () => {
    seedPermission(context, { id: 1, code: 'system:manage', name: '系统管理' });
    seedPermission(context, {
      id: 2,
      code: 'system:dictionary:manage',
      name: '字典管理',
    });
    seedPermission(context, {
      id: 3,
      code: 'system:role:manage',
      name: '角色管理',
    });
    seedMenuRoute(context, {
      id: 1,
      code: 'system-management',
      name: '系统管理',
      isGroup: true,
    });
    seedMenuRoutePermission(context, 1, ['system:manage']);
    seedMenuRoute(context, {
      id: 2,
      code: 'dictionary-management',
      name: '字典管理',
      routeName: 'dictionary',
      parentId: 1,
      sort: 1,
    });
    seedMenuRoutePermission(context, 2, ['system:dictionary:manage']);
    seedMenuRoute(context, {
      id: 3,
      code: 'role-management',
      name: '角色管理',
      routeName: 'role',
      parentId: 1,
      sort: 2,
    });
    seedMenuRoutePermission(context, 3, ['system:role:manage']);

    const created = await context.service.createItem({
      code: 'auditor',
      name: '审计员',
      permissionCodes: ['system:dictionary:manage'],
    });

    expect(created.permissionCodes).toEqual(['system:dictionary:manage']);
    expect(created).not.toHaveProperty('menuRouteIds');
    expect(created).not.toHaveProperty('userIds');

    const runtime = await context.service.getRuntimeByRoleCode('auditor');
    expect(runtime).not.toHaveProperty('permissionCodes');
    expect(runtime.menuTree).toHaveLength(1);
    expect(runtime.menuTree[0].code).toBe('system-management');
    expect(runtime.menuTree[0]).not.toHaveProperty('permissionCodes');
    expect(runtime.menuTree[0].children[0]).not.toHaveProperty('permissionCodes');
    expect(runtime.menuTree[0].children.map((item) => item.code)).toEqual([
      'dictionary-management',
    ]);
  });

  it('should reject disabled permission codes', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:role:manage',
      name: '角色管理',
      isEnabled: false,
    });

    await expect(
      context.service.createItem({
        code: 'disabled-role',
        name: '禁用权限角色',
        permissionCodes: ['system:role:manage'],
      }),
    ).rejects.toThrow('Permission codes disabled: system:role:manage');
  });

  it('should clear permission relations on update', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:dictionary:manage',
      name: '字典管理',
    });

    const created = await context.service.createItem({
      code: 'editor',
      name: '编辑员',
      permissionCodes: ['system:dictionary:manage'],
    });

    await context.service.updateItem(created.id, {
      code: created.code,
      name: '编辑员',
      permissionCodes: [],
    });

    expect(context.stores.rolePermissionRelations).toHaveLength(0);
  });

  it('should return enabled role options with minimal fields', async () => {
    context.stores.roleItems.set(
      1,
      createRoleItem({ code: 'admin', name: '管理员', isEnabled: true }, 1),
    );
    context.stores.roleItems.set(
      2,
      createRoleItem({ code: 'disabled', name: '禁用角色', isEnabled: false }, 2),
    );

    const options = await context.service.listOptions();

    expect(options).toEqual([{ code: 'admin', name: '管理员' }]);
    expect(options[0]).not.toHaveProperty('permissionCodes');
    expect(options[0]).not.toHaveProperty('isEnabled');
  });

  it('should invalidate runtime permission cache when role bindings change', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:role:manage',
      name: '角色管理',
    });

    const created = await context.service.createItem({
      code: 'role-cache',
      name: '缓存角色',
      permissionCodes: ['system:role:manage'],
    });
    await context.service.updateItem(created.id, {
      code: created.code,
      name: '缓存角色更新',
      permissionCodes: [],
    });
    await context.service.removeItem(created.id);

    expect(context.runtimePermissionService.invalidateAll).toHaveBeenCalledTimes(3);
  });

  // --- listItems ---

  it('should list roles with pagination', async () => {
    context.stores.roleItems.set(
      1,
      createRoleItem({ code: 'admin', name: '管理员', isEnabled: true }, 1),
    );
    context.stores.roleItems.set(
      2,
      createRoleItem({ code: 'editor', name: '编辑员', isEnabled: true }, 2),
    );
    context.stores.roleItems.set(
      3,
      createRoleItem({ code: 'viewer', name: '查看员', isEnabled: false }, 3),
    );

    const query = new RoleQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;

    const result = await context.service.listItems(query);
    expect(result.total).toBe(3);
    expect(result.list).toHaveLength(3);
  });

  it('should filter roles by keyword', async () => {
    context.stores.roleItems.set(
      1,
      createRoleItem({ code: 'admin', name: '管理员', isEnabled: true }, 1),
    );
    context.stores.roleItems.set(
      2,
      createRoleItem({ code: 'editor', name: '编辑员', isEnabled: true }, 2),
    );

    const query = new RoleQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;
    query.keyword = '管理';

    const result = await context.service.listItems(query);
    expect(result.total).toBe(1);
    expect(result.list[0].code).toBe('admin');
  });

  it('should filter roles by isEnabled flag', async () => {
    context.stores.roleItems.set(
      1,
      createRoleItem({ code: 'admin', name: '管理员', isEnabled: true }, 1),
    );
    context.stores.roleItems.set(
      2,
      createRoleItem({ code: 'disabled', name: '禁用角色', isEnabled: false }, 2),
    );

    const query = new RoleQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;
    query.isEnabled = false;

    const result = await context.service.listItems(query);
    expect(result.total).toBe(1);
    expect(result.list[0].code).toBe('disabled');
  });

  // --- getItem ---

  it('should get a single role by id', async () => {
    context.stores.roleItems.set(
      1,
      createRoleItem({ code: 'admin', name: '管理员', isEnabled: true }, 1),
    );

    const result = await context.service.getItem(1);
    expect(result.code).toBe('admin');
    expect(result.name).toBe('管理员');
  });

  it('should throw when getting a non-existent role by id', async () => {
    await expect(context.service.getItem(999)).rejects.toThrow('Role not found');
  });

  // --- updateItem ---

  it('should update a role', async () => {
    seedDefaultPermissions(context);

    const created = await context.service.createItem({
      code: 'editor',
      name: '编辑员',
      permissionCodes: ['system:dictionary:manage'],
    });

    const updated = await context.service.updateItem(created.id, {
      code: 'editor',
      name: '高级编辑员',
      description: '高级编辑权限',
      permissionCodes: [],
    });

    expect(updated.name).toBe('高级编辑员');
    expect(updated.description).toBe('高级编辑权限');
    expect(updated.permissionCodes).toEqual([]);
  });

  it('should reject update with duplicate code', async () => {
    seedDefaultPermissions(context);

    const roleA = await context.service.createItem({
      code: 'role-a',
      name: '角色A',
      permissionCodes: [],
    });
    await context.service.createItem({
      code: 'role-b',
      name: '角色B',
      permissionCodes: [],
    });

    await expect(
      context.service.updateItem(roleA.id, {
        code: 'role-b',
        name: '角色A',
        permissionCodes: [],
      }),
    ).rejects.toThrow('Role code already exists');
  });

  // --- removeItem ---

  it('should remove a role', async () => {
    seedDefaultPermissions(context);

    const created = await context.service.createItem({
      code: 'deleteme',
      name: '待删除角色',
      permissionCodes: [],
    });

    const removed = await context.service.removeItem(created.id);
    expect(removed.code).toBe('deleteme');
    expect(context.stores.roleItems.has(created.id)).toBe(false);
  });

  it('should throw when removing non-existent role', async () => {
    await expect(context.service.removeItem(999)).rejects.toThrow('Role not found');
  });

  // --- getRuntimeByRoleCode ---

  it('should return runtime preview for a valid role code', async () => {
    seedPermission(context, { id: 1, code: 'system:manage', name: '系统管理' });
    seedMenuRoute(context, {
      id: 1,
      code: 'system-management',
      name: '系统管理',
      isGroup: true,
    });
    seedMenuRoutePermission(context, 1, ['system:manage']);

    seedDefaultPermissions(context);
    const created = await context.service.createItem({
      code: 'runtime-role',
      name: '运行时角色',
      permissionCodes: ['system:manage'],
    });

    const runtime = await context.service.getRuntimeByRoleCode('runtime-role');
    expect(runtime.roleCode).toBe('runtime-role');
    expect(runtime.menuTree).toHaveLength(1);
  });

  it('should throw when getting runtime for non-existent role code', async () => {
    await expect(context.service.getRuntimeByRoleCode('non-existent')).rejects.toThrow(
      'Role not found or disabled',
    );
  });
});

const DEFAULT_PERMISSION_DATA = [
  {
    code: 'system:manage',
    name: '系统管理',
    groupKey: 'system',
    description: null,
    isEnabled: true,
  },
  {
    code: 'system:dictionary:manage',
    name: '字典管理',
    groupKey: 'system',
    description: null,
    isEnabled: true,
  },
  {
    code: 'system:role:manage',
    name: '角色管理',
    groupKey: 'system',
    description: null,
    isEnabled: true,
  },
];
