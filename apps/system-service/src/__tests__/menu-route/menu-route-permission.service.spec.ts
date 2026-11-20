import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { MenuRoutePermissionItem } from '@/modules/menu-route/entity/menu-route-permission.entity';
import { MenuRoutePermissionService } from '@/modules/menu-route/service/menu-route-permission.service';

type MockRepository<T extends object> = Partial<Record<keyof Repository<T>, any>>;

function createService() {
  const items: MenuRoutePermissionItem[] = [];
  let sequence = 1;

  const repository: MockRepository<MenuRoutePermissionItem> = {
    find: vi.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(filterItems(items, options?.where)),
    ),
    delete: vi.fn((criteria: { menuRouteId?: number }) => {
      const remaining = items.filter((item) => !matchesWhere(item, criteria));
      items.splice(0, items.length, ...remaining);
      return Promise.resolve({ affected: items.length < remaining.length ? 1 : 0 });
    }),
    create: vi.fn((input: Partial<MenuRoutePermissionItem>) => ({
      id: input.id ?? sequence++,
      menuRouteId: input.menuRouteId ?? 0,
      permissionId: input.permissionId ?? 0,
      createdAt: new Date('2026-05-29T00:00:00.000Z'),
      updatedAt: new Date('2026-05-29T00:00:00.000Z'),
    })),
    save: vi.fn((entity: MenuRoutePermissionItem) => {
      const existingIndex = items.findIndex((item) => item.id === entity.id);
      if (existingIndex >= 0) {
        items[existingIndex] = entity;
      } else {
        items.push(entity);
      }
      return Promise.resolve(entity);
    }),
  };

  return {
    service: new MenuRoutePermissionService(
      repository as unknown as Repository<MenuRoutePermissionItem>,
    ),
    stores: { items },
  };
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
      if (marker._type === 'in' && Array.isArray(marker._value)) {
        return marker._value.includes(current);
      }
    }
    return current === value;
  });
}

describe('MenuRoutePermissionService', () => {
  let context: ReturnType<typeof createService>;

  beforeEach(() => {
    context = createService();
  });

  it('should find menu route permission relations by menuRouteId', async () => {
    context.stores.items.push(
      {
        id: 1,
        menuRouteId: 10,
        permissionId: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MenuRoutePermissionItem,
      {
        id: 2,
        menuRouteId: 10,
        permissionId: 200,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MenuRoutePermissionItem,
      {
        id: 3,
        menuRouteId: 20,
        permissionId: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MenuRoutePermissionItem,
    );

    const result = await context.service.findByMenuRouteId(10);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.menuRouteId === 10)).toBe(true);
  });

  it('should return empty array when menuRouteId has no relations', async () => {
    context.stores.items.push({
      id: 1,
      menuRouteId: 10,
      permissionId: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as MenuRoutePermissionItem);

    const result = await context.service.findByMenuRouteId(99);
    expect(result).toHaveLength(0);
  });

  it('should find menu route permission relations by multiple menuRouteIds', async () => {
    context.stores.items.push(
      {
        id: 1,
        menuRouteId: 10,
        permissionId: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MenuRoutePermissionItem,
      {
        id: 2,
        menuRouteId: 20,
        permissionId: 200,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MenuRoutePermissionItem,
      {
        id: 3,
        menuRouteId: 30,
        permissionId: 300,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MenuRoutePermissionItem,
    );

    const result = await context.service.findByMenuRouteIds([10, 20]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.menuRouteId).sort()).toEqual([10, 20]);
  });

  it('should return empty array when menuRouteIds is empty', async () => {
    context.stores.items.push({
      id: 1,
      menuRouteId: 10,
      permissionId: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as MenuRoutePermissionItem);

    const result = await context.service.findByMenuRouteIds([]);
    expect(result).toHaveLength(0);
  });

  it('should clear all permission relations for a menuRouteId', async () => {
    context.stores.items.push(
      {
        id: 1,
        menuRouteId: 10,
        permissionId: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MenuRoutePermissionItem,
      {
        id: 2,
        menuRouteId: 10,
        permissionId: 200,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MenuRoutePermissionItem,
      {
        id: 3,
        menuRouteId: 20,
        permissionId: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MenuRoutePermissionItem,
    );

    await context.service.clearByMenuRouteId(10);

    expect(context.stores.items).toHaveLength(1);
    expect(context.stores.items[0].menuRouteId).toBe(20);
  });
});
