import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Repository } from 'typeorm';
import { ContextService } from '@nest-cloud/sdk';
import { DictionaryAggregateItem } from '@/modules/dictionary/entity/dictionary-aggregate.entity';
import { DictionaryItem } from '@/modules/dictionary/entity/dictionary-item.entity';
import { DictionaryNamespaceItem } from '@/modules/dictionary/entity/dictionary-namespace.entity';
import { DictionaryAggregateQueryForm } from '@/modules/dictionary/form/dictionary-aggregate-query.form';
import { DictionaryNamespaceQueryForm } from '@/modules/dictionary/form/dictionary-namespace-query.form';
import { DictionaryItemsQueryForm } from '@/modules/dictionary/form/dictionary-items-query.form';
import { DictionaryService } from '@/modules/dictionary/service/dictionary.service';
import { DictionaryNamespaceService } from '@/modules/dictionary/service/dictionary-namespace.service';
import { DictionaryAggregateService } from '@/modules/dictionary/service/dictionary-aggregate.service';
import { OperationLogService } from '@/modules/operation-log/service/operation-log.service';

type DictionaryRepository = Partial<Record<keyof Repository<DictionaryItem>, any>>;
type NamespaceRepository = Partial<Record<keyof Repository<DictionaryNamespaceItem>, any>>;
type AggregateRepository = Partial<Record<keyof Repository<DictionaryAggregateItem>, any>>;

function createService() {
  const items = new Map<string, DictionaryItem>();
  const namespaces = new Map<string, DictionaryNamespaceItem>();
  const aggregates = new Map<string, DictionaryAggregateItem>();
  let itemSequence = 1;
  let namespaceSequence = 1;
  let aggregateSequence = 1;

  const itemMapKey = (namespace: string, aggregateKey: string, key: string) =>
    `${namespace}:${aggregateKey}:${key}`;
  const aggregateMapKey = (namespace: string, aggregateKey: string) =>
    `${namespace}:${aggregateKey}`;

  const filterItems = (where?: {
    namespace?: string;
    aggregateKey?: string;
    key?: string | { _value: string[] };
    isEnabled?: boolean;
  }) =>
    [...items.values()]
      .filter((item) => {
        if (where?.namespace && item.namespace !== where.namespace) {
          return false;
        }
        if (where?.aggregateKey && item.aggregateKey !== where.aggregateKey) {
          return false;
        }
        if (where?.isEnabled !== undefined && item.isEnabled !== where.isEnabled) {
          return false;
        }
        if (!where?.key) {
          return true;
        }
        if (typeof where.key === 'string') {
          return item.key === where.key;
        }
        if (Array.isArray(where.key._value)) {
          return where.key._value.includes(item.key);
        }
        return true;
      })
      .sort((left, right) => left.key.localeCompare(right.key));

  const filterAggregates = (where?: {
    namespace?: string;
    aggregateKey?: string;
    isEnabled?: boolean;
  }) =>
    [...aggregates.values()]
      .filter((item) => {
        if (where?.namespace && item.namespace !== where.namespace) {
          return false;
        }
        if (where?.aggregateKey && item.aggregateKey !== where.aggregateKey) {
          return false;
        }
        if (where?.isEnabled !== undefined && item.isEnabled !== where.isEnabled) {
          return false;
        }
        return true;
      })
      .sort((left, right) => left.aggregateKey.localeCompare(right.aggregateKey));

  const repository: DictionaryRepository = {
    count: vi.fn((options?: { where?: { namespace?: string; aggregateKey?: string } }) =>
      Promise.resolve(filterItems(options?.where).length),
    ),
    findOne: vi.fn(
      ({
        where,
      }: {
        where: { id?: number; namespace?: string; aggregateKey?: string; key?: string };
      }) => {
        if (where.id !== undefined) {
          for (const item of items.values()) {
            if (item.id === where.id) {
              return Promise.resolve(item);
            }
          }
          return Promise.resolve(null);
        }
        if (where.namespace && where.aggregateKey && where.key) {
          return Promise.resolve(
            items.get(itemMapKey(where.namespace, where.aggregateKey, where.key)) ?? null,
          );
        }
        return Promise.resolve(filterItems(where)[0] ?? null);
      },
    ),
    find: vi.fn(({ where }: { where?: Parameters<typeof filterItems>[0] } = {}) =>
      Promise.resolve(filterItems(where)),
    ),
    findAndCount: vi.fn(
      ({
        where,
        skip = 0,
        take = 10,
      }: {
        where?: Parameters<typeof filterItems>[0];
        skip?: number;
        take?: number;
      }) => {
        const filteredItems = filterItems(where);
        return Promise.resolve([filteredItems.slice(skip, skip + take), filteredItems.length]);
      },
    ),
    create: vi.fn((input: Partial<DictionaryItem>) => {
      const existing =
        input.namespace && input.aggregateKey && input.key
          ? items.get(itemMapKey(input.namespace, input.aggregateKey, input.key))
          : undefined;
      return {
        id: input.id ?? existing?.id ?? itemSequence,
        namespace: input.namespace ?? '',
        aggregateKey: input.aggregateKey ?? '',
        key: input.key ?? '',
        value: input.value ?? null,
        label: input.label ?? null,
        description: input.description ?? null,
        isEnabled: input.isEnabled ?? true,
        createUser: input.createUser ?? existing?.createUser,
        updateUser: input.updateUser ?? existing?.updateUser,
        createdAt: existing?.createdAt ?? new Date('2026-03-21T00:00:00.000Z'),
        updatedAt: new Date('2026-03-21T00:00:00.000Z'),
      } as DictionaryItem;
    }),
    save: vi.fn((entity: DictionaryItem) => {
      if (!entity.id) {
        entity.id = itemSequence;
      }
      if (entity.id === itemSequence) {
        itemSequence += 1;
      }
      for (const [key, value] of items.entries()) {
        if (value.id === entity.id) {
          items.delete(key);
        }
      }
      items.set(itemMapKey(entity.namespace, entity.aggregateKey, entity.key), entity);
      return Promise.resolve(entity);
    }),
    remove: vi.fn((entity: DictionaryItem) => {
      items.delete(itemMapKey(entity.namespace, entity.aggregateKey, entity.key));
      return Promise.resolve(entity);
    }),
    update: vi.fn((id: number, data: Partial<DictionaryItem>) => {
      const entries = [...items.entries()];
      for (const [key, value] of entries) {
        if (value.id === id) {
          items.delete(key);
          const merged = { ...value };
          for (const [k, v] of Object.entries(data)) {
            if (v !== undefined) {
              (merged as any)[k] = v;
            }
          }
          items.set(
            itemMapKey(merged.namespace, merged.aggregateKey, merged.key),
            merged as DictionaryItem,
          );
          return Promise.resolve({ affected: 1 } as any);
        }
      }
      return Promise.resolve({ affected: 0 } as any);
    }),
    softDelete: vi.fn((id: number) => {
      for (const [key, value] of items.entries()) {
        if (value.id === id) {
          items.delete(key);
          return Promise.resolve({ affected: 1 } as any);
        }
      }
      return Promise.resolve({ affected: 0 } as any);
    }),
  };

  const namespaceRepository: NamespaceRepository = {
    findOne: vi.fn(({ where }: { where: { namespace: string } }) =>
      Promise.resolve(namespaces.get(where.namespace) ?? null),
    ),
    find: vi.fn(() =>
      Promise.resolve(
        [...namespaces.values()].sort((left, right) =>
          left.namespace.localeCompare(right.namespace),
        ),
      ),
    ),
    findAndCount: vi.fn(({ skip = 0, take = 10 }: { skip?: number; take?: number }) => {
      const rows = [...namespaces.values()].sort((left, right) =>
        left.namespace.localeCompare(right.namespace),
      );
      return Promise.resolve([rows.slice(skip, skip + take), rows.length]);
    }),
    create: vi.fn((input: Partial<DictionaryNamespaceItem>) => {
      const entity = {
        id: input.id ?? namespaceSequence++,
        namespace: input.namespace ?? '',
        label: input.label ?? null,
        description: input.description ?? null,
        isEnabled: input.isEnabled ?? true,
        createdAt: new Date('2026-03-21T00:00:00.000Z'),
        updatedAt: new Date('2026-03-21T00:00:00.000Z'),
      } as DictionaryNamespaceItem;
      namespaces.set(entity.namespace, entity);
      return Promise.resolve(entity);
    }),
    save: vi.fn((entity: DictionaryNamespaceItem) => {
      const existing = namespaces.get(entity.namespace);
      if (!entity.id) {
        entity.id = existing?.id ?? namespaceSequence;
      }
      if (!existing && entity.id === namespaceSequence) {
        namespaceSequence += 1;
      }
      namespaces.set(entity.namespace, entity);
      return Promise.resolve(entity);
    }),
    remove: vi.fn((entity: DictionaryNamespaceItem) => {
      namespaces.delete(entity.namespace);
      return Promise.resolve(entity);
    }),
    count: vi.fn(() => Promise.resolve(namespaces.size)),
  };

  const aggregateRepository: AggregateRepository = {
    findOne: vi.fn(({ where }: { where: { namespace: string; aggregateKey: string } }) =>
      Promise.resolve(aggregates.get(aggregateMapKey(where.namespace, where.aggregateKey)) ?? null),
    ),
    find: vi.fn(({ where }: { where?: Parameters<typeof filterAggregates>[0] } = {}) =>
      Promise.resolve(filterAggregates(where)),
    ),
    findAndCount: vi.fn(
      ({
        where,
        skip = 0,
        take = 10,
      }: {
        where?: Parameters<typeof filterAggregates>[0];
        skip?: number;
        take?: number;
      }) => {
        const rows = filterAggregates(where);
        return Promise.resolve([rows.slice(skip, skip + take), rows.length]);
      },
    ),
    create: vi.fn((input: Partial<DictionaryAggregateItem>) => ({
      id: input.id ?? aggregateSequence,
      namespace: input.namespace ?? '',
      aggregateKey: input.aggregateKey ?? '',
      label: input.label ?? null,
      description: input.description ?? null,
      isEnabled: input.isEnabled ?? true,
      createdAt: new Date('2026-03-21T00:00:00.000Z'),
      updatedAt: new Date('2026-03-21T00:00:00.000Z'),
    })),
    save: vi.fn((entity: DictionaryAggregateItem) => {
      const existing = aggregates.get(aggregateMapKey(entity.namespace, entity.aggregateKey));
      if (!entity.id) {
        entity.id = existing?.id ?? aggregateSequence;
      }
      if (!existing && entity.id === aggregateSequence) {
        aggregateSequence += 1;
      }
      aggregates.set(aggregateMapKey(entity.namespace, entity.aggregateKey), entity);
      return Promise.resolve(entity);
    }),
    remove: vi.fn((entity: DictionaryAggregateItem) => {
      aggregates.delete(aggregateMapKey(entity.namespace, entity.aggregateKey));
      return Promise.resolve(entity);
    }),
    count: vi.fn(() => Promise.resolve(aggregates.size)),
  };

  const namespaceService = {
    findByNamespace: vi.fn((namespace: string) =>
      Promise.resolve(namespaces.get(namespace) ?? null),
    ),
    listWithSummary: vi.fn(
      async (
        query: any,
        summaryMap: Map<string, { count: number; updatedAt: Date | undefined }>,
      ) => {
        const pageQuery = {
          page: query.pageNum ?? 1,
          pageSize: query.pageSize ?? 10,
          skip: ((query.pageNum ?? 1) - 1) * (query.pageSize ?? 10),
          take: query.pageSize ?? 10,
        };
        const allNamespaces = [...namespaces.values()].sort((a, b) =>
          a.namespace.localeCompare(b.namespace),
        );
        const filtered = allNamespaces.filter((item) => {
          if (query.isEnabled !== undefined && item.isEnabled !== query.isEnabled) return false;
          if (query.keyword) {
            const kw = query.keyword.toLowerCase();
            if (
              !(
                item.namespace.toLowerCase().includes(kw) ||
                (item.label && item.label.toLowerCase().includes(kw)) ||
                (item.description && item.description.toLowerCase().includes(kw))
              )
            ) {
              return false;
            }
          }
          return true;
        });
        const total = filtered.length;
        const paged = filtered.slice(pageQuery.skip, pageQuery.skip + pageQuery.take);
        return {
          list: paged.map((item) => ({
            id: item.id,
            namespace: item.namespace,
            label: item.label ?? undefined,
            description: item.description ?? undefined,
            isEnabled: item.isEnabled,
            count: summaryMap.get(item.namespace)?.count ?? 0,
            createdAt: item.createdAt.toISOString(),
            updatedAt: (summaryMap.get(item.namespace)?.updatedAt ?? item.updatedAt).toISOString(),
          })),
          total,
          page: pageQuery.page,
          pageSize: pageQuery.pageSize,
          totalPages: Math.ceil(total / pageQuery.pageSize),
        };
      },
    ),
    create: vi.fn((data: Partial<DictionaryNamespaceItem>) => {
      const entity = {
        id: namespaceSequence++,
        namespace: data.namespace ?? '',
        label: data.label ?? null,
        description: data.description ?? null,
        isEnabled: data.isEnabled ?? true,
        createdAt: new Date('2026-03-21T00:00:00.000Z'),
        updatedAt: new Date('2026-03-21T00:00:00.000Z'),
      } as DictionaryNamespaceItem;
      namespaces.set(entity.namespace, entity);
      return Promise.resolve(entity);
    }),
    delete: vi.fn(async (id: number) => {
      for (const [key, value] of namespaces.entries()) {
        if (value.id === id) {
          namespaces.delete(key);
          return value;
        }
      }
      return null;
    }),
    count: vi.fn(() => Promise.resolve(namespaces.size)),
    findOne: vi.fn((options: { where: { namespace: string } }) =>
      Promise.resolve(namespaces.get(options.where.namespace) ?? null),
    ),
    findAll: vi.fn(() =>
      Promise.resolve(
        [...namespaces.values()].sort((a, b) => a.namespace.localeCompare(b.namespace)),
      ),
    ),
    findAndCount: vi.fn(({ skip = 0, take = 10 }: { skip?: number; take?: number }) => {
      const rows = [...namespaces.values()].sort((a, b) => a.namespace.localeCompare(b.namespace));
      return Promise.resolve([rows.slice(skip, skip + take), rows.length]);
    }),
    createOrUpdate: vi.fn(
      async (id: number | undefined, data: Partial<DictionaryNamespaceItem>) => {
        if (id) {
          const existing = [...namespaces.values()].find((n) => n.id === id);
          if (existing) {
            namespaces.delete(existing.namespace);
            Object.assign(existing, data, { id });
            namespaces.set(existing.namespace, existing);
            return existing;
          }
        }
        const entity = {
          id: namespaceSequence++,
          namespace: data.namespace ?? '',
          label: data.label ?? null,
          description: data.description ?? null,
          isEnabled: data.isEnabled ?? true,
          createdAt: new Date('2026-03-21T00:00:00.000Z'),
          updatedAt: new Date('2026-03-21T00:00:00.000Z'),
        } as DictionaryNamespaceItem;
        namespaces.set(entity.namespace, entity);
        return entity;
      },
    ),
    get repo() {
      return namespaceRepository;
    },
    applyUpdateAudit: vi.fn(),
    getCurrentAccountId: vi.fn(() => 0),
    paginate: vi.fn(),
    repository: namespaceRepository as any,
  } as unknown as DictionaryNamespaceService;

  const aggregateService = {
    findByKey: vi.fn((namespace: string, aggregateKey: string) =>
      Promise.resolve(aggregates.get(aggregateMapKey(namespace, aggregateKey)) ?? null),
    ),
    listWithSummary: vi.fn(
      async (
        namespace: string,
        query: any,
        summaryMap: Map<string, { count: number; updatedAt: Date | undefined }>,
      ) => {
        const pageQuery = {
          page: query.pageNum ?? 1,
          pageSize: query.pageSize ?? 10,
          skip: ((query.pageNum ?? 1) - 1) * (query.pageSize ?? 10),
          take: query.pageSize ?? 10,
        };
        const filtered = [...aggregates.values()].filter((item) => {
          if (item.namespace !== namespace) return false;
          if (query.isEnabled !== undefined && item.isEnabled !== query.isEnabled) return false;
          if (query.keyword) {
            const kw = query.keyword.toLowerCase();
            if (
              !(
                item.aggregateKey.toLowerCase().includes(kw) ||
                (item.label && item.label.toLowerCase().includes(kw)) ||
                (item.description && item.description.toLowerCase().includes(kw))
              )
            ) {
              return false;
            }
          }
          return true;
        });
        const total = filtered.length;
        const paged = filtered.slice(pageQuery.skip, pageQuery.skip + pageQuery.take);
        return {
          list: paged.map((item) => {
            const summary = summaryMap.get(`${item.namespace}:${item.aggregateKey}`);
            return {
              id: item.id,
              namespace: item.namespace,
              aggregateKey: item.aggregateKey,
              label: item.label ?? undefined,
              description: item.description ?? undefined,
              isEnabled: item.isEnabled,
              count: summary?.count ?? 0,
              createdAt: item.createdAt.toISOString(),
              updatedAt: (summary?.updatedAt ?? item.updatedAt).toISOString(),
            };
          }),
          total,
          page: pageQuery.page,
          pageSize: pageQuery.pageSize,
          totalPages: Math.ceil(total / pageQuery.pageSize),
        };
      },
    ),
    create: vi.fn((data: Partial<DictionaryAggregateItem>) => {
      const entity = {
        id: aggregateSequence++,
        namespace: data.namespace ?? '',
        aggregateKey: data.aggregateKey ?? '',
        label: data.label ?? null,
        description: data.description ?? null,
        isEnabled: data.isEnabled ?? true,
        createdAt: new Date('2026-03-21T00:00:00.000Z'),
        updatedAt: new Date('2026-03-21T00:00:00.000Z'),
      } as DictionaryAggregateItem;
      aggregates.set(aggregateMapKey(entity.namespace, entity.aggregateKey), entity);
      return Promise.resolve(entity);
    }),
    delete: vi.fn(async (id: number) => {
      for (const [key, value] of aggregates.entries()) {
        if (value.id === id) {
          aggregates.delete(key);
          return value;
        }
      }
      return null;
    }),
    count: vi.fn(() => Promise.resolve(aggregates.size)),
    findOne: vi.fn((options: { where: { namespace: string; aggregateKey: string } }) =>
      Promise.resolve(
        aggregates.get(aggregateMapKey(options.where.namespace, options.where.aggregateKey)) ??
          null,
      ),
    ),
    findAll: vi.fn(() =>
      Promise.resolve(
        [...aggregates.values()].sort((a, b) => a.aggregateKey.localeCompare(b.aggregateKey)),
      ),
    ),
    findAndCount: vi.fn(({ skip = 0, take = 10 }: { skip?: number; take?: number }) => {
      const rows = [...aggregates.values()].sort((a, b) =>
        a.aggregateKey.localeCompare(b.aggregateKey),
      );
      return Promise.resolve([rows.slice(skip, skip + take), rows.length]);
    }),
    createOrUpdate: vi.fn(
      async (id: number | undefined, data: Partial<DictionaryAggregateItem>) => {
        if (id) {
          const existing = [...aggregates.values()].find((a) => a.id === id);
          if (existing) {
            aggregates.delete(aggregateMapKey(existing.namespace, existing.aggregateKey));
            Object.assign(existing, data, { id });
            aggregates.set(aggregateMapKey(existing.namespace, existing.aggregateKey), existing);
            return existing;
          }
        }
        const entity = {
          id: aggregateSequence++,
          namespace: data.namespace ?? '',
          aggregateKey: data.aggregateKey ?? '',
          label: data.label ?? null,
          description: data.description ?? null,
          isEnabled: data.isEnabled ?? true,
          createdAt: new Date('2026-03-21T00:00:00.000Z'),
          updatedAt: new Date('2026-03-21T00:00:00.000Z'),
        } as DictionaryAggregateItem;
        aggregates.set(aggregateMapKey(entity.namespace, entity.aggregateKey), entity);
        return entity;
      },
    ),
    get repo() {
      return aggregateRepository;
    },
    applyUpdateAudit: vi.fn(),
    getCurrentAccountId: vi.fn(() => 0),
    paginate: vi.fn(),
    repository: aggregateRepository as any,
  } as unknown as DictionaryAggregateService;

  const operationLogService = {
    log: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as OperationLogService;

  const seedItem = (input: Partial<DictionaryItem>) => {
    const entity = repository.create?.(input) as DictionaryItem;
    return repository.save?.(entity) as Promise<DictionaryItem>;
  };

  return {
    service: new DictionaryService(
      repository as unknown as Repository<DictionaryItem>,
      namespaceService,
      aggregateService,
      operationLogService,
    ),
    seedItem,
  };
}

function createItemsQuery(input: Partial<DictionaryItemsQueryForm>): DictionaryItemsQueryForm {
  return Object.assign(new DictionaryItemsQueryForm(), input);
}

function createAggregateQuery(
  input: Partial<DictionaryAggregateQueryForm>,
): DictionaryAggregateQueryForm {
  return Object.assign(new DictionaryAggregateQueryForm(), input);
}

function runWithCurrentAccount<T>(
  account: { accountId: number },
  action: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    ContextService.setStore(
      {
        req: {
          session: { account },
        } as unknown as import('@nest-cloud/sdk').AccountSessionRequest,
        res: {} as any,
      },
      () => {
        action().then(resolve, reject);
      },
    );
  });
}

describe('DictionaryService', () => {
  it('should support aggregate import, item update and delete', async () => {
    const { service } = createService();

    const imported = await service.importNamespace('system', [
      {
        aggregateKey: 'theme',
        key: 'default',
        value: 'aurora',
        label: '默认主题',
        isEnabled: true,
      },
    ]);

    expect(imported.importedCount).toBe(1);
    expect(imported.createdCount).toBe(1);
    expect(imported.updatedCount).toBe(0);
    expect(
      (
        await service.getItem({
          namespace: 'system',
          aggregateKey: 'theme',
          key: 'default',
        })
      ).value,
    ).toBe('aurora');

    const updated = await service.upsertItem(
      { namespace: 'system', aggregateKey: 'theme', key: 'default' },
      {
        value: 'nebula',
        label: '新主题',
        isEnabled: false,
      },
    );
    expect(updated.value).toBe('nebula');
    expect(updated.isEnabled).toBe(false);

    const removed = await service.removeItem({
      namespace: 'system',
      aggregateKey: 'theme',
      key: 'default',
    });
    expect(removed.key).toBe('default');
    expect(
      await service.listItems(createItemsQuery({ namespace: 'system', aggregateKey: 'theme' })),
    ).toHaveLength(0);
  });

  it('should populate audit fields and reload dictionary item after save', async () => {
    const { service } = createService();

    const created = await runWithCurrentAccount({ accountId: 9 }, () =>
      service.upsertItem(
        { namespace: 'common', aggregateKey: 'enabled-state', key: 'true' },
        {
          value: true,
          label: '启用',
        },
      ),
    );

    expect(created.createdAt).toBe('2026-03-21T00:00:00.000Z');
    const item = await service.getItem({
      namespace: 'common',
      aggregateKey: 'enabled-state',
      key: 'true',
    });
    expect(item.createdAt).toBe('2026-03-21T00:00:00.000Z');
    expect((service as any).repository.findOne).toHaveBeenCalledWith({
      where: {
        namespace: 'common',
        aggregateKey: 'enabled-state',
        key: 'true',
      },
    });

    await runWithCurrentAccount({ accountId: 11 }, () =>
      service.upsertItem(
        { namespace: 'common', aggregateKey: 'enabled-state', key: 'true' },
        {
          value: false,
        },
      ),
    );
    const stored = await (service as any).repository.findOne({
      where: {
        namespace: 'common',
        aggregateKey: 'enabled-state',
        key: 'true',
      },
    });
    expect(stored.createUser).toBe(9);
    expect(stored.updateUser).toBe(11);
  });

  it('should manage aggregates and block non-empty aggregate removal', async () => {
    const { service } = createService();

    const aggregate = await service.upsertAggregate('common', 'enabled-state', {
      label: '启停状态',
    });
    expect(aggregate.aggregateKey).toBe('enabled-state');
    expect(aggregate.label).toBe('启停状态');

    await service.upsertItem(
      { namespace: 'common', aggregateKey: 'enabled-state', key: 'true' },
      {
        value: true,
        label: '启用',
      },
    );
    await expect(service.removeAggregate('common', 'enabled-state')).rejects.toThrow(
      'Dictionary aggregate is not empty: common.enabled-state',
    );

    await service.removeItem({
      namespace: 'common',
      aggregateKey: 'enabled-state',
      key: 'true',
    });
    await expect(service.removeAggregate('common', 'enabled-state')).resolves.toMatchObject({
      aggregateKey: 'enabled-state',
    });
  });

  it('should remove empty namespace only when aggregates are removed', async () => {
    const { service } = createService();

    await service.upsertAggregate('custom', 'status', { label: '状态' });
    await expect(service.removeNamespace('custom')).rejects.toThrow(
      'Dictionary namespace is not empty: custom',
    );
    await service.removeAggregate('custom', 'status');
    await expect(service.removeNamespace('custom')).resolves.toMatchObject({
      namespace: 'custom',
    });
  });

  it('should support batch fetch by aggregate keys', async () => {
    const { service } = createService();

    await service.importNamespace('system', [
      {
        aggregateKey: 'theme',
        key: 'default',
        value: 'aurora',
        label: '默认主题',
      },
      {
        aggregateKey: 'theme',
        key: 'dark',
        value: 'nebula',
        label: '暗色主题',
      },
      {
        aggregateKey: 'locale',
        key: 'default',
        value: 'zh-CN',
        label: '默认语言',
      },
    ]);

    const result = await service.listItems(
      createItemsQuery({
        namespace: 'system',
        aggregateKey: 'theme',
        keys: ['default', 'missing'],
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      aggregateKey: 'theme',
      key: 'default',
    });
  });

  it('should return only enabled runtime items by aggregate', async () => {
    const { service } = createService();

    await service.importNamespace('common', [
      {
        aggregateKey: 'enabled-state',
        key: 'true',
        value: true,
        label: '启用',
        isEnabled: true,
      },
      {
        aggregateKey: 'enabled-state',
        key: 'false',
        value: false,
        label: '停用',
        isEnabled: false,
      },
      {
        aggregateKey: 'status',
        key: 'archived',
        value: 'archived',
        label: '归档',
        isEnabled: true,
      },
    ]);

    const result = await service.listRuntimeItems(
      createItemsQuery({
        namespace: 'common',
        aggregateKey: 'enabled-state',
        keys: ['true', 'false'],
      }),
    );

    expect(result.map((item) => item.key)).toEqual(['true']);
  });

  it('should return empty runtime items when aggregate is disabled', async () => {
    const { service } = createService();

    await service.importNamespace('common', [
      {
        aggregateKey: 'enabled-state',
        key: 'true',
        value: true,
        label: '启用',
        isEnabled: true,
      },
    ]);
    await service.upsertAggregate('common', 'enabled-state', {
      isEnabled: false,
    });

    await expect(
      service.listRuntimeItems(
        createItemsQuery({
          namespace: 'common',
          aggregateKey: 'enabled-state',
        }),
      ),
    ).resolves.toEqual([]);
  });

  it('keeps project probe limits editable as JSON numbers including zero', async () => {
    const { service } = createService();
    const namespace = 'system';
    const aggregateKey = 'api_call_graph_probe';
    const calls = { namespace, aggregateKey, key: 'maxCallsPerRequest' };
    const snapshots = { namespace, aggregateKey, key: 'maxSnapshotValuesPerCall' };
    const query = createItemsQuery({ namespace, aggregateKey });
    await service.upsertItem(calls, { value: 0 });
    await service.upsertItem(snapshots, { value: 1000 });
    const values = async () =>
      Object.fromEntries(
        (await service.listRuntimeItems(query)).map((item) => [item.key, item.value]),
      );
    expect(await values()).toEqual({ maxCallsPerRequest: 0, maxSnapshotValuesPerCall: 1000 });

    await service.upsertItem(calls, { value: 25 });
    await service.upsertItem(snapshots, { value: 0 });
    expect(await values()).toEqual({ maxCallsPerRequest: 25, maxSnapshotValuesPerCall: 0 });
  });

  // --- listNamespaces ---

  it('should list namespaces with item count summaries', async () => {
    const { service, seedItem } = createService();

    await service.upsertNamespace('system', { label: '系统' });
    await service.upsertNamespace('common', { label: '通用' });
    await seedItem({ namespace: 'system', aggregateKey: 'theme', key: 'default', value: 'light' });
    await seedItem({ namespace: 'system', aggregateKey: 'theme', key: 'dark', value: 'dark' });
    await seedItem({ namespace: 'common', aggregateKey: 'status', key: 'active', value: 'active' });

    const query = new DictionaryNamespaceQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;

    const result = await service.listNamespaces(query);
    expect(result.total).toBe(2);
    expect(result.list).toHaveLength(2);
    const systemNs = result.list.find((n) => n.namespace === 'system');
    expect(systemNs?.count).toBe(2);
    const commonNs = result.list.find((n) => n.namespace === 'common');
    expect(commonNs?.count).toBe(1);
  });

  it('should return empty list when no namespaces exist', async () => {
    const { service } = createService();

    const query = new DictionaryNamespaceQueryForm();
    query.pageNum = 1;
    query.pageSize = 10;

    const result = await service.listNamespaces(query);
    expect(result.total).toBe(0);
    expect(result.list).toHaveLength(0);
  });

  // --- getNamespace ---

  it('should get a namespace by name', async () => {
    const { service, seedItem } = createService();

    await service.upsertNamespace('system', { label: '系统' });
    await seedItem({ namespace: 'system', aggregateKey: 'theme', key: 'default', value: 'light' });

    const result = await service.getNamespace('system');
    expect(result.namespace).toBe('system');
    expect(result.count).toBe(1);
  });

  it('should throw when getting a non-existent namespace', async () => {
    const { service } = createService();

    await expect(service.getNamespace('non-existent')).rejects.toThrow(
      'Dictionary namespace not found: non-existent',
    );
  });

  // --- upsertNamespace ---

  it('should create a new namespace', async () => {
    const { service } = createService();

    const result = await service.upsertNamespace('new-ns', {
      label: '新命名空间',
      description: '用于测试',
    });

    expect(result.namespace).toBe('new-ns');
    expect(result.label).toBe('新命名空间');
    expect(result.description).toBe('用于测试');
    expect(result.isEnabled).toBe(true);
  });

  it('should update an existing namespace', async () => {
    const { service, seedItem } = createService();

    await seedItem({ namespace: 'system', aggregateKey: 'theme', key: 'default', value: 'light' });

    const result = await service.upsertNamespace('system', {
      label: '更新后的标签',
      description: '更新后的描述',
    });

    expect(result.namespace).toBe('system');
    expect(result.label).toBe('更新后的标签');
    expect(result.description).toBe('更新后的描述');
  });

  it('should preserve existing label and description when not provided', async () => {
    const { service, seedItem } = createService();

    await seedItem({ namespace: 'system', aggregateKey: 'theme', key: 'default', value: 'light' });

    await service.upsertNamespace('system', { label: '初始标签', description: '初始描述' });
    const updated = await service.upsertNamespace('system', {});

    expect(updated.label).toBe('初始标签');
    expect(updated.description).toBe('初始描述');
  });

  // --- removeNamespace ---

  it('should remove an empty namespace', async () => {
    const { service } = createService();

    await service.upsertNamespace('empty-ns', { label: '空命名空间' });
    const result = await service.removeNamespace('empty-ns');
    expect(result.namespace).toBe('empty-ns');

    await expect(service.getNamespace('empty-ns')).rejects.toThrow(
      'Dictionary namespace not found',
    );
  });

  it('should throw when removing a non-empty namespace', async () => {
    const { service, seedItem } = createService();

    await service.upsertNamespace('system', { label: '系统' });
    await service.upsertAggregate('system', 'theme', { label: '主题' });
    await seedItem({ namespace: 'system', aggregateKey: 'theme', key: 'default', value: 'light' });

    await expect(service.removeNamespace('system')).rejects.toThrow(
      'Dictionary namespace is not empty: system',
    );
  });

  it('should throw when removing a non-existent namespace', async () => {
    const { service } = createService();

    await expect(service.removeNamespace('non-existent')).rejects.toThrow(
      'Dictionary namespace not found: non-existent',
    );
  });
});
