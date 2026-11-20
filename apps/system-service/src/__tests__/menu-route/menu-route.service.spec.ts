import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ILike, In, Repository } from 'typeorm';
import { MenuRouteItem } from '@/modules/menu-route/entity/menu-route.entity';
import { MenuRoutePermissionItem } from '@/modules/menu-route/entity/menu-route-permission.entity';
import { MenuRouteQueryForm } from '@/modules/menu-route/form/menu-route-query.form';
import { RuntimePermissionService } from '@/modules/account/service/runtime-permission.service';
import { MenuRouteService } from '@/modules/menu-route/service/menu-route.service';
import { MenuRoutePermissionService } from '@/modules/menu-route/service/menu-route-permission.service';
import { OperationLogService } from '@/modules/operation-log/service/operation-log.service';
import { PermissionService } from '@/modules/permission/service/permission.service';

type MockRepository = Partial<Record<keyof Repository<MenuRouteItem>, any>>;

type MenuRouteServiceContext = ReturnType<typeof createService>;

function createService() {
  const items = new Map<number, MenuRouteItem>();
  let sequence = 1;

  const permissionRelations: MenuRoutePermissionItem[] = [];

  const repository: MockRepository = {
    count: vi.fn((options?: { where?: { parentId?: number } }) => {
      if (!options?.where?.parentId) {
        return Promise.resolve(items.size);
      }

      return Promise.resolve(
        [...items.values()].filter((item) => item.parentId === options.where?.parentId).length,
      );
    }),
    findOne: vi.fn(({ where }: { where: { id?: number; code?: string } }) => {
      if (where.id !== undefined) {
        return Promise.resolve(items.get(where.id) ?? null);
      }

      return Promise.resolve([...items.values()].find((item) => item.code === where.code) ?? null);
    }),
    find: vi.fn((options?: { where?: any }) => {
      let values = [...items.values()];
      if (options?.where) {
        const whereList = Array.isArray(options.where) ? options.where : [options.where];
        values = values.filter((item) => whereList.some((where) => matchesWhere(item, where)));
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
    create: vi.fn(
      (input: Partial<MenuRouteItem>) =>
        ({
          id: input.id ?? sequence,
          code: input.code ?? '',
          name: input.name ?? '',
          parentId: input.parentId ?? null,
          routeName: input.routeName ?? null,
          redirect: input.redirect ?? null,
          icon: input.icon ?? null,
          sort: input.sort ?? 0,
          isEnabled: input.isEnabled ?? true,
          isGroup: input.isGroup ?? false,
          hideHeader: input.hideHeader ?? false,
          hideRoute: input.hideRoute ?? false,
          routeRoot: input.routeRoot ?? null,
          createdAt: new Date('2026-05-26T00:00:00.000Z'),
          updatedAt: new Date('2026-05-26T00:00:00.000Z'),
        }) as MenuRouteItem,
    ),
    save: vi.fn((entity: MenuRouteItem) => {
      if (!entity.id) {
        entity.id = sequence;
      }
      if (entity.id === sequence) {
        sequence += 1;
      }
      items.set(entity.id, entity);
      return Promise.resolve(entity);
    }),
    remove: vi.fn((entity: MenuRouteItem) => {
      items.delete(entity.id);
      return Promise.resolve(entity);
    }),
    update: vi.fn((id: number, data: Partial<MenuRouteItem>) => {
      const item = items.get(id);
      if (item) {
        Object.assign(item, data);
        item.id = id;
      }
      return Promise.resolve({ affected: item ? 1 : 0 } as any);
    }),
    softDelete: vi.fn((id: number) => {
      items.delete(id);
      return Promise.resolve({ affected: 1 } as any);
    }),
  };

  const menuRoutePermissionRepo = {
    find: vi.fn(({ where }: { where: { menuRouteId?: any } }) => {
      if (where?.menuRouteId?._type === 'in' && Array.isArray(where.menuRouteId._value)) {
        return Promise.resolve(
          permissionRelations.filter((rel) => where.menuRouteId._value.includes(rel.menuRouteId)),
        );
      }
      const ids = Array.isArray(where?.menuRouteId) ? where.menuRouteId : [where?.menuRouteId];
      return Promise.resolve(permissionRelations.filter((rel) => ids.includes(rel.menuRouteId)));
    }),
    save: vi.fn((entities: MenuRoutePermissionItem[]) => {
      permissionRelations.push(...entities);
      return Promise.resolve(entities);
    }),
    delete: vi.fn(({ menuRouteId }: { menuRouteId: number }) => {
      const before = permissionRelations.length;
      for (let i = permissionRelations.length - 1; i >= 0; i--) {
        if (permissionRelations[i].menuRouteId === menuRouteId) {
          permissionRelations.splice(i, 1);
        }
      }
      return Promise.resolve({ affected: before - permissionRelations.length });
    }),
    create: vi.fn((input: Partial<MenuRoutePermissionItem>) => {
      const entity = {
        ...input,
        id: input.id ?? ++sequence,
        menuRouteId: input.menuRouteId ?? 0,
        permissionId: input.permissionId ?? 0,
        createdAt: new Date('2026-05-26T00:00:00.000Z'),
        updatedAt: new Date('2026-05-26T00:00:00.000Z'),
      } as MenuRoutePermissionItem;
      permissionRelations.push(entity);
      return Promise.resolve(entity);
    }),
    clearByMenuRouteId: vi.fn((menuRouteId: number) => {
      for (let i = permissionRelations.length - 1; i >= 0; i--) {
        if (permissionRelations[i].menuRouteId === menuRouteId) {
          permissionRelations.splice(i, 1);
        }
      }
      return Promise.resolve(undefined);
    }),
    findByMenuRouteIds: vi.fn((ids: number[]) => {
      if (!ids.length) return Promise.resolve([]);
      return Promise.resolve(permissionRelations.filter((rel) => ids.includes(rel.menuRouteId)));
    }),
  };

  const permissionCodeMap = new Map<number, string>();

  const permissionService = {
    ensureDefaultPermissions: vi.fn(async () => undefined),
    assertCodesDefined: vi.fn(async (_codes: string[]) => undefined),
    assertCodesExist: vi.fn(async (_codes: string[]) => undefined),
    getIdsByCodes: vi.fn(async (codes: string[]) => {
      const ids: number[] = [];
      codes.forEach((code) => {
        let id = [...permissionCodeMap.entries()].find(([_, c]) => c === code)?.[0];
        if (!id) {
          id = permissionCodeMap.size + 1;
          permissionCodeMap.set(id, code);
        }
        ids.push(id);
      });
      return ids;
    }),
    getCodesByIds: vi.fn(async (ids: number[]) => {
      const map = new Map<number, string>();
      ids.forEach((id) => {
        const code = permissionCodeMap.get(id);
        if (code) {
          map.set(id, code);
        }
      });
      return map;
    }),
  };
  const operationLogService = {
    log: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as OperationLogService;
  const runtimePermissionService = {
    invalidateAll: vi.fn(),
  } as unknown as RuntimePermissionService;

  return {
    service: new MenuRouteService(
      repository as unknown as Repository<MenuRouteItem>,
      menuRoutePermissionRepo as unknown as MenuRoutePermissionService,
      permissionService as unknown as PermissionService,
      operationLogService,
      runtimePermissionService,
    ),
    permissionService,
    runtimePermissionService,
  };
}

function matchesWhere(item: MenuRouteItem, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    const current = (item as unknown as Record<string, unknown>)[key];
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

describe('MenuRouteService', () => {
  let context: MenuRouteServiceContext;
  let service: MenuRouteService;

  beforeEach(() => {
    context = createService();
    service = context.service;
  });

  it('should build tree and prevent deleting a parent with children', async () => {
    const root = await service.createItem({
      code: 'dashboard',
      name: '仪表盘',
      sort: 1,
      permissionCodes: ['dashboard:view'],
    });
    await service.createItem({
      code: 'dashboard.analysis',
      name: '分析页',
      parentId: root.id,
      sort: 1,
      permissionCodes: ['dashboard:analysis:view'],
    });

    const tree = await service.listTree(new MenuRouteQueryForm());
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].permissionCodes).toEqual(['dashboard:view']);

    await expect(service.removeItem(root.id)).rejects.toThrow('still has 1 child items');
  });

  it('should keep original code when updating an existing menu route', async () => {
    const created = await service.createItem({
      code: 'dictionary-management',
      name: '字典管理',
      routeName: 'dictionary',
      icon: 'dictionary',
      sort: 1,
      permissionCodes: ['system:dictionary:manage'],
    });

    const updated = await service.updateItem(created.id, {
      name: '字典设置',
      routeName: 'dictionary',
      icon: 'dictionary',
      sort: 2,
      permissionCodes: ['system:dictionary:manage'],
    });

    expect(updated.code).toBe('dictionary-management');
    expect(updated.routeName).toBe('dictionary');
  });

  it('should support keyword filter, batch status update and reorder', async () => {
    const first = await service.createItem({
      code: 'permission-management',
      name: '权限管理',
      sort: 1,
      permissionCodes: ['system:permission:manage'],
    });
    const second = await service.createItem({
      code: 'role-management',
      name: '角色管理',
      sort: 2,
      permissionCodes: ['system:role:manage'],
    });

    const query = new MenuRouteQueryForm();
    query.keyword = '权限';
    const filtered = await service.listItems(query);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(first.id);

    const updatedStatus = await service.batchUpdateStatus({
      ids: [first.id, second.id],
      isEnabled: false,
    });
    expect(updatedStatus.every((item) => item.isEnabled === false)).toBe(true);

    const reordered = await service.reorderItems({
      items: [
        { id: first.id, sort: 3 },
        { id: second.id, sort: 1 },
      ],
    });
    expect(reordered.map((item) => item.id)).toEqual([second.id, first.id]);
  });

  it('should invalidate runtime permission cache when menu routes change', async () => {
    const item = await service.createItem({
      code: 'cache-test',
      name: '缓存测试',
      sort: 1,
      permissionCodes: [],
    });

    await service.updateItem(item.id, {
      name: item.name,
      routeName: item.routeName ?? undefined,
      icon: item.icon ?? undefined,
      sort: 2,
      permissionCodes: [],
    });

    expect(context.runtimePermissionService.invalidateAll).toHaveBeenCalledTimes(2);
  });

  // --- getItem ---

  it('should get a single menu route by id', async () => {
    const created = await service.createItem({
      code: 'single-item',
      name: '单项菜单',
      sort: 1,
      permissionCodes: [],
    });

    const result = await service.getItem(created.id);
    expect(result.code).toBe('single-item');
    expect(result.name).toBe('单项菜单');
    expect(result.sort).toBe(1);
  });

  it('should throw when getting a non-existent menu route by id', async () => {
    await expect(service.getItem(999)).rejects.toThrow('Menu route not found');
  });

  // --- removeItem ---

  it('should remove a leaf menu route', async () => {
    const created = await service.createItem({
      code: 'leaf-menu',
      name: '叶子菜单',
      sort: 1,
      permissionCodes: [],
    });

    const removed = await service.removeItem(created.id);
    expect(removed.code).toBe('leaf-menu');
    expect(await service['findOne'](created.id)).toBeNull();
  });

  it('should throw when removing a menu route with children', async () => {
    const parent = await service.createItem({
      code: 'parent-menu',
      name: '父菜单',
      sort: 1,
      permissionCodes: [],
    });
    await service.createItem({
      code: 'child-menu',
      name: '子菜单',
      parentId: parent.id,
      sort: 1,
      permissionCodes: [],
    });

    await expect(service.removeItem(parent.id)).rejects.toThrow('still has 1 child items');
  });

  it('should throw when removing non-existent menu route', async () => {
    await expect(service.removeItem(999)).rejects.toThrow('Menu route not found');
  });

  // --- listItems ---

  it('should list menu routes with keyword filter', async () => {
    await service.createItem({
      code: 'dashboard',
      name: '仪表盘',
      sort: 1,
      permissionCodes: [],
    });
    await service.createItem({
      code: 'analytics',
      name: '分析页',
      sort: 2,
      permissionCodes: [],
    });

    const query = new MenuRouteQueryForm();
    query.keyword = '仪表';
    const result = await service.listItems(query);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('仪表盘');
  });

  it('should list menu routes with isEnabled filter', async () => {
    await service.createItem({
      code: 'enabled-menu',
      name: '启用菜单',
      sort: 1,
      isEnabled: true,
      permissionCodes: [],
    });
    await service.createItem({
      code: 'disabled-menu',
      name: '禁用菜单',
      sort: 2,
      isEnabled: false,
      permissionCodes: [],
    });

    const query = new MenuRouteQueryForm();
    query.isEnabled = false;
    const result = await service.listItems(query);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('disabled-menu');
  });
});
