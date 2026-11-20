import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { DictionaryNamespaceItem } from '@/modules/dictionary/entity/dictionary-namespace.entity';
import { DictionaryNamespaceService } from '@/modules/dictionary/service/dictionary-namespace.service';
import { DictionaryNamespaceQueryForm } from '@/modules/dictionary/form/dictionary-namespace-query.form';

type MockRepository<T extends object> = Partial<Record<keyof Repository<T>, any>>;

function createService() {
  const items: DictionaryNamespaceItem[] = [];
  let sequence = 1;

  const repository: MockRepository<DictionaryNamespaceItem> = {
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
    findOne: vi.fn(({ where }: { where: { namespace?: string } }) =>
      Promise.resolve(items.find((item) => item.namespace === where?.namespace) ?? null),
    ),
    create: vi.fn((input: Partial<DictionaryNamespaceItem>) => {
      const entity: Partial<DictionaryNamespaceItem> = {
        namespace: input.namespace,
        label: input.label,
        description: input.description,
        isEnabled: input.isEnabled,
        createdAt: new Date('2026-05-29T00:00:00.000Z'),
        updatedAt: new Date('2026-05-29T00:00:00.000Z'),
      };
      // Only set id if explicitly provided
      if (input.id !== undefined) {
        (entity as DictionaryNamespaceItem).id = input.id;
      }
      return entity as DictionaryNamespaceItem;
    }),
    save: vi.fn((entity: DictionaryNamespaceItem) => {
      const existingIndex = items.findIndex((item) => item.id === entity.id);
      if (existingIndex >= 0) {
        items[existingIndex] = entity;
      } else {
        items.push(entity);
      }
      return Promise.resolve(entity);
    }),
    update: vi.fn((id: number, data: Partial<DictionaryNamespaceItem>) => {
      const item = items.find((i) => i.id === id);
      if (item) {
        // Only assign fields that are defined in data (skip undefined)
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
    service: new DictionaryNamespaceService(
      repository as unknown as Repository<DictionaryNamespaceItem>,
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

describe('DictionaryNamespaceService', () => {
  let context: ReturnType<typeof createService>;

  beforeEach(() => {
    context = createService();
  });

  it('should create or update a namespace', async () => {
    const created = await context.service.createOrUpdate(undefined, {
      namespace: 'test-ns',
      label: '测试命名空间',
      description: '用于测试',
    });

    expect(created).toBeTruthy();
    expect(created!.namespace).toBe('test-ns');
    expect(created!.label).toBe('测试命名空间');

    const updated = await context.service.createOrUpdate(created!.id, {
      label: '更新后的名称',
    });

    expect(updated?.label).toBe('更新后的名称');
  });

  it('should list namespaces with summary', async () => {
    context.stores.items.push(
      {
        id: 1,
        namespace: 'system',
        label: '系统',
        description: '系统字典',
        isEnabled: true,
        createdAt: new Date('2026-05-29'),
        updatedAt: new Date('2026-05-29'),
      } as DictionaryNamespaceItem,
      {
        id: 2,
        namespace: 'common',
        label: '通用',
        description: '通用字典',
        isEnabled: true,
        createdAt: new Date('2026-05-30'),
        updatedAt: new Date('2026-05-30'),
      } as DictionaryNamespaceItem,
      {
        id: 3,
        namespace: 'disabled-ns',
        label: '禁用',
        description: '',
        isEnabled: false,
        createdAt: new Date('2026-05-28'),
        updatedAt: new Date('2026-05-28'),
      } as DictionaryNamespaceItem,
    );

    const itemCountByNamespace = new Map<string, { count: number; updatedAt: Date | undefined }>();
    itemCountByNamespace.set('system', { count: 5, updatedAt: new Date('2026-05-29') });
    itemCountByNamespace.set('common', { count: 3, updatedAt: new Date('2026-05-30') });
    itemCountByNamespace.set('disabled-ns', { count: 0, updatedAt: undefined });

    const query = new DictionaryNamespaceQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;

    const result = await context.service.listWithSummary(query, itemCountByNamespace);

    expect(result.total).toBe(3);
    expect(result.list).toHaveLength(3);
    expect(result.list[0].namespace).toBe('common');
    expect(result.list[0].count).toBe(3);
    expect(result.list[2].namespace).toBe('system');
    expect(result.list[2].count).toBe(5);
  });

  it('should filter namespaces by isEnabled flag', async () => {
    context.stores.items.push(
      {
        id: 1,
        namespace: 'enabled-ns',
        label: '启用',
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DictionaryNamespaceItem,
      {
        id: 2,
        namespace: 'disabled-ns',
        label: '禁用',
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as DictionaryNamespaceItem,
    );

    const query = new DictionaryNamespaceQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;
    query.isEnabled = true;

    const result = await context.service.listWithSummary(query, new Map());

    expect(result.total).toBe(1);
    expect(result.list[0].namespace).toBe('enabled-ns');
  });

  it('should find namespace by exact namespace string', async () => {
    context.stores.items.push({
      id: 1,
      namespace: 'system',
      label: '系统',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as DictionaryNamespaceItem);

    const result = await context.service.findByNamespace('system');
    expect(result).toBeTruthy();
    expect(result?.namespace).toBe('system');
  });

  it('should return null when namespace not found', async () => {
    const result = await context.service.findByNamespace('non-existent');
    expect(result).toBeNull();
  });

  it('should expose repo getter returning the repository', async () => {
    expect(context.service.repo).toBeDefined();
    expect(typeof context.service.repo.findAndCount).toBe('function');
  });
});
