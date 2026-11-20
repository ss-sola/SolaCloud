import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { RuntimePermissionService } from '@/modules/account/service/runtime-permission.service';
import { OperationLogService } from '@/modules/operation-log/service/operation-log.service';
import { PermissionItem } from '@/modules/permission/entity/permission.entity';
import { PermissionService } from '@/modules/permission/service/permission.service';
import { PermissionQueryForm } from '@/modules/permission/form/permission-query.form';

type MockRepository<T extends object> = Partial<Record<keyof Repository<T>, any>>;

function createService() {
  const permissionItems = new Map<string, PermissionItem>();
  let sequence = 1;
  let createSeq = 1;

  const repository: MockRepository<PermissionItem> = {
    count: vi.fn(() => Promise.resolve(permissionItems.size)),
    findOne: vi.fn(({ where }: { where: { code?: string; id?: number } }) => {
      if (where.code) {
        return Promise.resolve(permissionItems.get(where.code) ?? null);
      }
      if (where.id !== undefined) {
        return Promise.resolve(
          [...permissionItems.values()].find((item) => item.id === where.id) ?? null,
        );
      }
      return Promise.resolve(null);
    }),
    find: vi.fn((options?: { where?: Record<string, unknown>; order?: Record<string, string> }) => {
      let values = [...permissionItems.values()];
      if (options?.where) {
        values = values.filter((item) => matchesWhere(item, options.where!));
      }
      if (options?.order?.code === 'ASC') {
        values.sort((a, b) => a.code.localeCompare(b.code));
      }
      return Promise.resolve(values);
    }),
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
        const whereList = Array.isArray(where) ? where : [where];
        const allItems = [...permissionItems.values()];
        const filtered = allItems.filter((item) => whereList.some((w) => matchesWhere(item, w)));
        return Promise.resolve([filtered.slice(skip, skip + take), filtered.length]);
      },
    ),
    create: vi.fn((input: Partial<PermissionItem>) => createPermissionItem(input, createSeq++)),
    save: vi.fn((entity: PermissionItem) => {
      if (!entity.id) {
        entity.id = sequence++;
      }
      entity.updatedAt = new Date('2026-05-30T00:00:00.000Z');
      permissionItems.set(entity.code, entity);
      return Promise.resolve(entity);
    }),
    update: vi.fn((id: number, data: Partial<PermissionItem>) => {
      const item = [...permissionItems.values()].find((i) => i.id === id);
      if (item) {
        Object.assign(item, data);
        item.id = id;
      }
      return Promise.resolve({ affected: item ? 1 : 0 } as any);
    }),
    softDelete: vi.fn((id: number) => {
      for (const [code, item] of permissionItems.entries()) {
        if (item.id === id) {
          permissionItems.delete(code);
          return Promise.resolve({ affected: 1 } as any);
        }
      }
      return Promise.resolve({ affected: 0 } as any);
    }),
  };

  const operationLogService = {
    log: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as OperationLogService;
  const runtimePermissionService = {
    invalidateAll: vi.fn(),
  } as unknown as RuntimePermissionService;

  return {
    service: new PermissionService(
      repository as unknown as Repository<PermissionItem>,
      operationLogService,
      runtimePermissionService,
    ),
    repository,
    runtimePermissionService,
    stores: { permissionItems },
  };
}

function createPermissionItem(input: Partial<PermissionItem>, id: number): PermissionItem {
  return {
    id: input.id ?? id,
    code: input.code ?? '',
    name: input.name ?? '',
    groupKey: input.groupKey ?? null,
    description: input.description ?? null,
    isEnabled: input.isEnabled ?? true,
    createdAt: new Date('2026-05-30T00:00:00.000Z'),
    updatedAt: new Date('2026-05-30T00:00:00.000Z'),
  } as PermissionItem;
}

function filterItems<T extends object>(items: T[], where?: Record<string, unknown>) {
  if (!where) return [...items];
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

describe('PermissionService', () => {
  let context: ReturnType<typeof createService>;

  beforeEach(() => {
    context = createService();
  });

  // --- listItems ---

  it('should list all permissions with pagination', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date('2026-05-30'),
      updatedAt: new Date('2026-05-30'),
    });
    seedPermission(context, {
      id: 2,
      code: 'user:manage',
      name: '用户管理',
      groupKey: 'user',
      isEnabled: true,
      createdAt: new Date('2026-05-31'),
      updatedAt: new Date('2026-05-31'),
    });
    seedPermission(context, {
      id: 3,
      code: 'role:manage',
      name: '角色管理',
      groupKey: 'role',
      isEnabled: false,
      createdAt: new Date('2026-05-29'),
      updatedAt: new Date('2026-05-29'),
    });

    const query = new PermissionQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;

    const result = await context.service.listItems(query);
    expect(result.total).toBe(3);
    expect(result.list).toHaveLength(3);
  });

  it('should filter permissions by keyword in code, name, groupKey or description', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedPermission(context, {
      id: 2,
      code: 'user:manage',
      name: '用户管理',
      groupKey: 'user',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const query = new PermissionQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;
    query.keyword = '系统';

    const result = await context.service.listItems(query);
    expect(result.total).toBe(1);
    expect(result.list[0].code).toBe('system:manage');
  });

  it('should filter permissions by isEnabled flag', async () => {
    seedPermission(context, {
      id: 1,
      code: 'enabled-perm',
      name: '启用权限',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedPermission(context, {
      id: 2,
      code: 'disabled-perm',
      name: '禁用权限',
      groupKey: 'system',
      isEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const query = new PermissionQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;
    query.isEnabled = false;

    const result = await context.service.listItems(query);
    expect(result.total).toBe(1);
    expect(result.list[0].code).toBe('disabled-perm');
  });

  // --- getItem ---

  it('should get a single permission by id', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date('2026-05-30'),
      updatedAt: new Date('2026-05-30'),
    });

    const result = await context.service.getItem(1);
    expect(result.code).toBe('system:manage');
    expect(result.name).toBe('系统管理');
  });

  it('should throw when getting a non-existent permission by id', async () => {
    await expect(context.service.getItem(999)).rejects.toThrow('Permission not found');
  });

  // --- getByCode ---

  it('should get permission by code', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await context.service.getByCode('system:manage');
    expect(result).toBeTruthy();
    expect(result?.code).toBe('system:manage');
  });

  it('should return null when getting permission by non-existent code', async () => {
    const result = await context.service.getByCode('non:existent');
    expect(result).toBeNull();
  });

  // --- assertCodesExist ---

  it('should resolve when all codes exist and are enabled', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(context.service.assertCodesExist(['system:manage'])).resolves.toBeUndefined();
  });

  it('should throw when asserting non-existent permission codes', async () => {
    await expect(context.service.assertCodesExist(['non:existent'])).rejects.toThrow(
      'Permission code not found or disabled',
    );
  });

  it('should throw when asserting disabled permission codes', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(context.service.assertCodesExist(['system:manage'])).rejects.toThrow(
      'Permission code not found or disabled',
    );
  });

  // --- assertCodesDefined ---

  it('should resolve when codes are defined regardless of enabled status', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(context.service.assertCodesDefined(['system:manage'])).resolves.toBeUndefined();
  });

  it('should throw when asserting codes that do not exist', async () => {
    await expect(context.service.assertCodesDefined(['non:existent'])).rejects.toThrow(
      'Permission code not found',
    );
  });

  // --- getIdsByCodes ---

  it('should return ids for given permission codes', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedPermission(context, {
      id: 2,
      code: 'user:manage',
      name: '用户管理',
      groupKey: 'user',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await context.service.getIdsByCodes(['system:manage', 'user:manage']);
    expect(result).toEqual([1, 2]);
  });

  it('should return empty array when getting ids by empty codes', async () => {
    const result = await context.service.getIdsByCodes([]);
    expect(result).toEqual([]);
  });

  // --- getCodesByIds ---

  it('should return code map for given ids', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedPermission(context, {
      id: 2,
      code: 'user:manage',
      name: '用户管理',
      groupKey: 'user',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await context.service.getCodesByIds([1, 2]);
    expect(result.get(1)).toBe('system:manage');
    expect(result.get(2)).toBe('user:manage');
  });

  it('should return empty map when getting codes by empty ids', async () => {
    const result = await context.service.getCodesByIds([]);
    expect(result.size).toBe(0);
  });

  // --- findByIds ---

  it('should find permissions by ids', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedPermission(context, {
      id: 2,
      code: 'user:manage',
      name: '用户管理',
      groupKey: 'user',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await context.service.findByIds([1, 2]);
    expect(result).toHaveLength(2);
  });

  it('should return empty array when finding by empty ids', async () => {
    const result = await context.service.findByIds([]);
    expect(result).toEqual([]);
  });

  it('should filter by enabled only when specified', async () => {
    seedPermission(context, {
      id: 1,
      code: 'enabled-perm',
      name: '启用权限',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedPermission(context, {
      id: 2,
      code: 'disabled-perm',
      name: '禁用权限',
      groupKey: 'system',
      isEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await context.service.findByIds([1, 2], true);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('enabled-perm');
  });

  // --- findByCodes ---

  it('should find permissions by codes', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedPermission(context, {
      id: 2,
      code: 'user:manage',
      name: '用户管理',
      groupKey: 'user',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await context.service.findByCodes(['system:manage', 'user:manage']);
    expect(result).toHaveLength(2);
  });

  it('should return empty array when finding by empty codes', async () => {
    const result = await context.service.findByCodes([]);
    expect(result).toEqual([]);
  });

  it('should deduplicate and trim codes', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await context.service.findByCodes(['  system:manage  ', 'system:manage']);
    expect(result).toHaveLength(1);
  });

  // --- createItem ---

  it('should create a permission item', async () => {
    const result = await context.service.createItem({
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      description: '系统管理权限',
      isEnabled: true,
    });

    expect(result.code).toBe('system:manage');
    expect(result.name).toBe('系统管理');
    expect(context.runtimePermissionService.invalidateAll).toHaveBeenCalled();
  });

  it('should reject creation with duplicate code', async () => {
    await context.service.createItem({
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
    });

    await expect(
      context.service.createItem({
        code: 'system:manage',
        name: '重复权限',
        groupKey: 'system',
      }),
    ).rejects.toThrow('Permission code already exists');
  });

  it('should reject creation with empty code', async () => {
    await expect(
      context.service.createItem({
        code: '  ',
        name: '空代码权限',
      }),
    ).rejects.toThrow('Permission code is required');
  });

  // --- updateItem ---

  it('should update a permission item', async () => {
    const created = await context.service.createItem({
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
    });

    const updated = await context.service.updateItem(created.id, {
      code: 'system:manage',
      name: '系统管理更新',
      groupKey: 'system',
      description: '更新后的描述',
    });

    expect(updated.name).toBe('系统管理更新');
    expect(updated.description).toBe('更新后的描述');
    expect(context.runtimePermissionService.invalidateAll).toHaveBeenCalled();
  });

  it('should reject update with duplicate code on different id', async () => {
    await context.service.createItem({ code: 'perm:a', name: '权限A', groupKey: 'system' });
    const permB = await context.service.createItem({
      code: 'perm:b',
      name: '权限B',
      groupKey: 'system',
    });

    // Update permB's code to match permA's code — should fail
    await expect(
      context.service.updateItem(permB.id, {
        code: 'perm:a',
        name: '权限B更新',
        groupKey: 'system',
      }),
    ).rejects.toThrow(/Permission code already exists/);
  });

  it('should throw when updating non-existent permission', async () => {
    await expect(
      context.service.updateItem(999, { code: 'new:code', name: 'New' }),
    ).rejects.toThrow('Permission not found');
  });

  // --- removeItem ---

  it('should remove a permission item', async () => {
    const created = await context.service.createItem({
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
    });

    const removed = await context.service.removeItem(created.id);
    expect(removed.code).toBe('system:manage');
    expect(context.stores.permissionItems.has('system:manage')).toBe(false);
    expect(context.runtimePermissionService.invalidateAll).toHaveBeenCalled();
  });

  it('should throw when removing non-existent permission', async () => {
    await expect(context.service.removeItem(999)).rejects.toThrow('Permission not found');
  });

  // --- Code normalization ---

  it('should trim and deduplicate codes when asserting existence', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      context.service.assertCodesExist(['  system:manage  ', 'system:manage']),
    ).resolves.toBeUndefined();
  });

  it('should filter blank codes when processing', async () => {
    seedPermission(context, {
      id: 1,
      code: 'system:manage',
      name: '系统管理',
      groupKey: 'system',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      context.service.assertCodesExist(['system:manage', '', '  ', 'non:exist']),
    ).rejects.toThrow('Permission code not found or disabled');
  });
});

function seedPermission(
  context: ReturnType<typeof createService>,
  input: Partial<PermissionItem> & { id: number; code: string },
) {
  context.stores.permissionItems.set(input.code, {
    id: input.id,
    code: input.code,
    name: input.name ?? '',
    groupKey: input.groupKey ?? null,
    description: input.description ?? null,
    isEnabled: input.isEnabled ?? true,
    createdAt: input.createdAt ?? new Date('2026-05-30'),
    updatedAt: input.updatedAt ?? new Date('2026-05-30'),
  } as PermissionItem);
}
