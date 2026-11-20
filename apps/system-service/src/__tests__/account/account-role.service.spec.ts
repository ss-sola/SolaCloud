import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { AccountRoleItem } from '@/modules/account/entity/account-role.entity';
import { AccountRoleService } from '@/modules/account/service/account-role.service';

type MockRepository<T extends object> = Partial<Record<keyof Repository<T>, any>>;

function createService() {
  const items: AccountRoleItem[] = [];
  let sequence = 1;

  const repository: MockRepository<AccountRoleItem> = {
    find: vi.fn((options?: { where?: Record<string, unknown> }) =>
      Promise.resolve(filterItems(items, options?.where)),
    ),
    delete: vi.fn((criteria: { accountId?: number }) => {
      const remaining = items.filter((item) => !matchesWhere(item, criteria));
      items.splice(0, items.length, ...remaining);
      return Promise.resolve({ affected: items.length < remaining.length ? 1 : 0 });
    }),
    create: vi.fn((input: Partial<AccountRoleItem>) => ({
      id: input.id ?? sequence++,
      accountId: input.accountId ?? 0,
      roleId: input.roleId ?? 0,
      createdAt: new Date('2026-05-29T00:00:00.000Z'),
      updatedAt: new Date('2026-05-29T00:00:00.000Z'),
    })),
    save: vi.fn((entity: AccountRoleItem) => {
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
    service: new AccountRoleService(repository as unknown as Repository<AccountRoleItem>),
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

describe('AccountRoleService', () => {
  let context: ReturnType<typeof createService>;

  beforeEach(() => {
    context = createService();
  });

  it('should find account role relations by accountId', async () => {
    context.stores.items.push(
      {
        id: 1,
        accountId: 10,
        roleId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AccountRoleItem,
      {
        id: 2,
        accountId: 10,
        roleId: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AccountRoleItem,
      {
        id: 3,
        accountId: 20,
        roleId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AccountRoleItem,
    );

    const result = await context.service.findByAccountId(10);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.accountId === 10)).toBe(true);
  });

  it('should return empty array when accountId has no relations', async () => {
    context.stores.items.push({
      id: 1,
      accountId: 10,
      roleId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as AccountRoleItem);

    const result = await context.service.findByAccountId(99);
    expect(result).toHaveLength(0);
  });

  it('should find account role relations by roleId', async () => {
    context.stores.items.push(
      {
        id: 1,
        accountId: 10,
        roleId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AccountRoleItem,
      {
        id: 2,
        accountId: 20,
        roleId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AccountRoleItem,
      {
        id: 3,
        accountId: 30,
        roleId: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AccountRoleItem,
    );

    const result = await context.service.findByRoleId(1);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.roleId === 1)).toBe(true);
  });

  it('should clear all role relations for an accountId', async () => {
    context.stores.items.push(
      {
        id: 1,
        accountId: 10,
        roleId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AccountRoleItem,
      {
        id: 2,
        accountId: 10,
        roleId: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AccountRoleItem,
      {
        id: 3,
        accountId: 20,
        roleId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AccountRoleItem,
    );

    await context.service.clearByAccountId(10);

    expect(context.stores.items).toHaveLength(1);
    expect(context.stores.items[0].accountId).toBe(20);
  });

  it('should expose repo getter returning the repository', async () => {
    expect(context.service.repo).toBeDefined();
    expect(typeof context.service.repo.find).toBe('function');
  });
});
