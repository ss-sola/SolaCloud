import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { RolePermissionItem } from '@/modules/role/entity/role-permission.entity';
import { RolePermissionService } from '@/modules/role/service/role-permission.service';

type MockRepository<T extends object> = Partial<Record<keyof Repository<T>, any>>;

function createService() {
  const items: RolePermissionItem[] = [];
  let sequence = 1;

  const repository: MockRepository<RolePermissionItem> = {
    find: vi.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(filterItems(items, options?.where)),
    ),
    delete: vi.fn((criteria: { roleId?: number }) => {
      const remaining = items.filter((item) => !matchesWhere(item, criteria));
      items.splice(0, items.length, ...remaining);
      return Promise.resolve({ affected: items.length < remaining.length ? 1 : 0 });
    }),
    create: vi.fn((input: Partial<RolePermissionItem>) => ({
      id: input.id ?? sequence++,
      roleId: input.roleId ?? 0,
      permissionId: input.permissionId ?? 0,
      createdAt: new Date('2026-05-29T00:00:00.000Z'),
      updatedAt: new Date('2026-05-29T00:00:00.000Z'),
    })),
    save: vi.fn((entity: RolePermissionItem) => {
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
    service: new RolePermissionService(repository as unknown as Repository<RolePermissionItem>),
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

describe('RolePermissionService', () => {
  let context: ReturnType<typeof createService>;

  beforeEach(() => {
    context = createService();
  });

  it('should find role permission relations by roleId', async () => {
    context.stores.items.push(
      {
        id: 1,
        roleId: 10,
        permissionId: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as RolePermissionItem,
      {
        id: 2,
        roleId: 10,
        permissionId: 200,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as RolePermissionItem,
      {
        id: 3,
        roleId: 20,
        permissionId: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as RolePermissionItem,
    );

    const result = await context.service.findByRoleId(10);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.roleId === 10)).toBe(true);
  });

  it('should return empty array when roleId has no relations', async () => {
    context.stores.items.push({
      id: 1,
      roleId: 10,
      permissionId: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as RolePermissionItem);

    const result = await context.service.findByRoleId(99);
    expect(result).toHaveLength(0);
  });

  it('should clear all permission relations for a roleId', async () => {
    context.stores.items.push(
      {
        id: 1,
        roleId: 10,
        permissionId: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as RolePermissionItem,
      {
        id: 2,
        roleId: 10,
        permissionId: 200,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as RolePermissionItem,
      {
        id: 3,
        roleId: 20,
        permissionId: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as RolePermissionItem,
    );

    await context.service.clearByRoleId(10);

    expect(context.stores.items).toHaveLength(1);
    expect(context.stores.items[0].roleId).toBe(20);
  });
});
