import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { DictionaryAggregateItem } from '@/modules/dictionary/entity/dictionary-aggregate.entity';
import { DictionaryAggregateService } from '@/modules/dictionary/service/dictionary-aggregate.service';
import { DictionaryAggregateQueryForm } from '@/modules/dictionary/form/dictionary-aggregate-query.form';

type MockRepository<T extends object> = Partial<Record<keyof Repository<T>, any>>;

function createService() {
  const items: DictionaryAggregateItem[] = [];
  let sequence = 1;

  const repository: MockRepository<DictionaryAggregateItem> = {
    findAndCount: vi.fn(
      ({
        where,
        skip = 0,
        take = 10,
        order,
      }: {
        where?: Record<string, unknown>;
        skip?: number;
        take?: number;
        order?: Record<string, string>;
      }) => {
        let filtered = filterItems(items, where);
        if (order) {
          const field = Object.keys(order)[0];
          const dir = order[field] === 'DESC' ? -1 : 1;
          filtered.sort(
            (a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * dir,
          );
        }
        const totalCount = filtered.length;
        filtered = filtered.slice(skip, skip + take);
        return Promise.resolve([filtered, totalCount]);
      },
    ),
    findOne: vi.fn((options?: { where?: Record<string, unknown> }) => {
      if (!options?.where) return Promise.resolve(null);
      const where = options.where;
      if (where.id !== undefined) {
        const byId = items.find((item) => item.id === where.id);
        if (byId) return Promise.resolve(byId);
      }
      const found = items.find((item) => {
        for (const [key, value] of Object.entries(where)) {
          if ((item as any)[key] !== value) return false;
        }
        return true;
      });
      return Promise.resolve(found ?? null);
    }),
    create: vi.fn((input: Partial<DictionaryAggregateItem>) => {
      const entity: Partial<DictionaryAggregateItem> = {
        namespace: input.namespace,
        aggregateKey: input.aggregateKey,
        label: input.label,
        description: input.description,
        isEnabled: input.isEnabled,
        createdAt: new Date('2026-05-29T00:00:00.000Z'),
        updatedAt: new Date('2026-05-29T00:00:00.000Z'),
      };
      if (input.id !== undefined) {
        (entity as DictionaryAggregateItem).id = input.id;
      }
      return entity as DictionaryAggregateItem;
    }),
    save: vi.fn((entity: DictionaryAggregateItem) => {
      const existingIndex = items.findIndex((item) => item.id === entity.id);
      if (existingIndex >= 0) {
        items[existingIndex] = entity;
      } else {
        items.push(entity);
      }
      return Promise.resolve(entity);
    }),
    update: vi.fn((id: number, data: Partial<DictionaryAggregateItem>) => {
      const item = items.find((i) => i.id === id);
      if (item) {
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) {
            (item as unknown as Record<string, unknown>)[key] = value;
          }
        }
      }
      return Promise.resolve({ affected: item ? 1 : 0 } as any);
    }),
  };

  return {
    service: new DictionaryAggregateService(
      repository as unknown as Repository<DictionaryAggregateItem>,
    ),
    stores: { items },
  };
}

function filterItems<T extends object>(items: T[], where?: Record<string, unknown>) {
  if (!where) return [...items];
  const whereList = Array.isArray(where) ? where : [where];
  return items.filter((item) => whereList.some((w) => matchesWhere(item, w)));
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
    }
    return current === value;
  });
}

describe('DictionaryAggregateService', () => {
  let context: ReturnType<typeof createService>;

  beforeEach(() => {
    context = createService();
  });

  it('should create or update an aggregate', async () => {
    const created = await context.service.createOrUpdate(undefined, {
      namespace: 'system',
      aggregateKey: 'theme',
      label: '主题',
      description: '主题设置',
    });

    expect(created).toBeTruthy();
    expect(created!.namespace).toBe('system');
    expect(created!.aggregateKey).toBe('theme');

    const updated = await context.service.createOrUpdate(created!.id, {
      label: '更新后的名称',
    });

    expect(updated?.label).toBe('更新后的名称');
  });

  it('should list aggregates with summary', async () => {
    context.stores.items.push(
      {
        id: 1,
        namespace: 'system',
        aggregateKey: 'theme',
        label: '主题',
        description: '主题设置',
        isEnabled: true,
        createdAt: new Date('2026-05-29'),
        updatedAt: new Date('2026-05-29'),
      } as DictionaryAggregateItem,
      {
        id: 2,
        namespace: 'system',
        aggregateKey: 'locale',
        label: '语言',
        description: '语言设置',
        isEnabled: true,
        createdAt: new Date('2026-05-30'),
        updatedAt: new Date('2026-05-30'),
      } as DictionaryAggregateItem,
      {
        id: 3,
        namespace: 'common',
        aggregateKey: 'status',
        label: '状态',
        description: '',
        isEnabled: false,
        createdAt: new Date('2026-05-28'),
        updatedAt: new Date('2026-05-28'),
      } as DictionaryAggregateItem,
    );

    const itemCountByAggregate = new Map<string, { count: number; updatedAt: Date | undefined }>();
    itemCountByAggregate.set('system:theme', { count: 5, updatedAt: new Date('2026-05-29') });
    itemCountByAggregate.set('system:locale', { count: 3, updatedAt: new Date('2026-05-30') });
    itemCountByAggregate.set('common:status', { count: 0, updatedAt: undefined });

    const query = new DictionaryAggregateQueryForm();
    query.namespace = 'system';
    query.pageNum = 1;
    query.pageSize = 10;

    const result = await context.service.listWithSummary('system', query, itemCountByAggregate);

    expect(result.total).toBe(2);
    expect(result.list).toHaveLength(2);
    expect(result.list[0].aggregateKey).toBe('locale');
    expect(result.list[0].count).toBe(3);
  });

  it('should filter aggregates by isEnabled flag', async () => {
    context.stores.items.push(
      {
        id: 1,
        namespace: 'system',
        aggregateKey: 'enabled',
        label: '启用',
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DictionaryAggregateItem,
      {
        id: 2,
        namespace: 'system',
        aggregateKey: 'disabled',
        label: '禁用',
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DictionaryAggregateItem,
    );

    const query = new DictionaryAggregateQueryForm();
    query.namespace = 'system';
    query.pageNum = 1;
    query.pageSize = 10;
    query.isEnabled = true;

    const result = await context.service.listWithSummary('system', query, new Map());

    expect(result.total).toBe(1);
    expect(result.list[0].aggregateKey).toBe('enabled');
  });

  it('should find aggregate by namespace and aggregateKey', async () => {
    context.stores.items.push({
      id: 1,
      namespace: 'system',
      aggregateKey: 'theme',
      label: '主题',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as DictionaryAggregateItem);

    const result = await context.service.findByKey('system', 'theme');
    expect(result).toBeTruthy();
    expect(result?.aggregateKey).toBe('theme');
  });

  it('should return null when aggregate not found', async () => {
    const result = await context.service.findByKey('non-existent', 'missing');
    expect(result).toBeNull();
  });

  it('should trim namespace and aggregateKey when finding by key', async () => {
    context.stores.items.push({
      id: 1,
      namespace: 'system',
      aggregateKey: 'theme',
      label: '主题',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as DictionaryAggregateItem);

    const result = await context.service.findByKey('  system  ', '  theme  ');
    expect(result).toBeTruthy();
    expect(result?.aggregateKey).toBe('theme');
  });

  it('should expose repo getter returning the repository', async () => {
    expect(context.service.repo).toBeDefined();
    expect(typeof context.service.repo.findAndCount).toBe('function');
  });
});
