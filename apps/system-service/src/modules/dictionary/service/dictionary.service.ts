import { BaseService, ProjectException } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import { SYSTEM_SERVICE_NAME } from '../../../system-service.constants';
import { PageResult } from '../../../utils/pagination.types';
import { PaginationUtil } from '../../../utils/pagination.util';
import { OperationLogService } from '../../operation-log/service/operation-log.service';
import { DictionaryAggregateService } from './dictionary-aggregate.service';
import { DictionaryNamespaceService } from './dictionary-namespace.service';
import {
  DictionaryAggregateRecord,
  DictionaryImportItem,
  DictionaryImportResult,
  DictionaryItemKey,
  DictionaryItemQuery,
  DictionaryItemsLookup,
  DictionaryNamespaceRecord,
  DictionaryRecord,
} from '../dictionary.types';
import { DictionaryUtil } from '../dictionary.util';
import { DictionaryAggregateItem } from '../entity/dictionary-aggregate.entity';
import { DictionaryItem } from '../entity/dictionary-item.entity';
import { DictionaryNamespaceItem } from '../entity/dictionary-namespace.entity';
import { DictionaryAggregateQueryForm } from '../form/dictionary-aggregate-query.form';
import { DictionaryItemsQueryForm } from '../form/dictionary-items-query.form';
import { DictionaryNamespaceQueryForm } from '../form/dictionary-namespace-query.form';

@Injectable()
export class DictionaryService extends BaseService<DictionaryItem> {
  private readonly logger = new Logger(DictionaryService.name);

  constructor(
    @InjectRepository(DictionaryItem)
    protected readonly repository: Repository<DictionaryItem>,
    private readonly namespaceService: DictionaryNamespaceService,
    private readonly aggregateService: DictionaryAggregateService,
    private readonly operationLogService: OperationLogService,
  ) {
    super(repository);
  }

  async getOverview() {
    return {
      service: SYSTEM_SERVICE_NAME,
      namespaceCount: await this.namespaceService.repo.count(),
      aggregateCount: await this.aggregateService.repo.count(),
      itemCount: await this.repository.count(),
      capabilities: [
        'namespace-query',
        'namespace-crud',
        'aggregate-query',
        'aggregate-crud',
        'item-crud',
        'namespace-import',
        'runtime-query',
        'enable-disable',
      ],
    };
  }

  async listNamespaces(
    query: DictionaryNamespaceQueryForm,
  ): Promise<PageResult<DictionaryNamespaceRecord>> {
    const items = await this.repository.find({ order: { namespace: 'ASC', updatedAt: 'DESC' } });
    const summaryMap = this.buildNamespaceSummaryMap(items);
    return this.namespaceService.listWithSummary(query, summaryMap);
  }

  async getNamespace(namespace: string): Promise<DictionaryNamespaceRecord> {
    DictionaryUtil.assertRequired('namespace', namespace);
    const entity = await this.namespaceService.findByNamespace(namespace);
    if (!entity) {
      throw new ProjectException(`Dictionary namespace not found: ${namespace}`);
    }

    const count = await this.repository.count({
      where: { namespace: entity.namespace },
    });
    const latestItem = await this.repository.findOne({
      where: { namespace: entity.namespace },
      order: { updatedAt: 'DESC' },
    });
    return {
      id: entity.id,
      namespace: entity.namespace,
      label: entity.label ?? undefined,
      description: entity.description ?? undefined,
      isEnabled: entity.isEnabled,
      count,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: (latestItem?.updatedAt ?? entity.updatedAt).toISOString(),
    };
  }

  async upsertNamespace(
    namespace: string,
    payload: Partial<DictionaryNamespaceRecord>,
  ): Promise<DictionaryNamespaceRecord> {
    DictionaryUtil.assertRequired('namespace', namespace);
    const normalizedNamespace = namespace.trim();
    const current = await this.namespaceService.findByNamespace(normalizedNamespace);
    const entityPayload: Partial<DictionaryNamespaceItem> = {
      label:
        payload.label !== undefined
          ? (DictionaryUtil.normalizeOptionalString(payload.label) ?? null)
          : (current?.label ?? null),
      description:
        payload.description !== undefined
          ? (DictionaryUtil.normalizeOptionalString(payload.description) ?? null)
          : (current?.description ?? null),
      isEnabled: payload.isEnabled ?? current?.isEnabled ?? true,
    };

    let saved: DictionaryNamespaceItem;
    if (current) {
      saved =
        (await this.namespaceService.createOrUpdate(current.id, entityPayload)) ??
        (await this.namespaceService.create({
          namespace: normalizedNamespace,
          ...entityPayload,
        }));
    } else {
      saved = await this.namespaceService.create({
        namespace: normalizedNamespace,
        ...entityPayload,
      });
    }

    await this.operationLogService.log({
      module: 'dictionary',
      action: current ? 'namespace-update' : 'namespace-create',
      targetType: 'namespace',
      targetId: saved.namespace,
      summary: `Dictionary namespace ${current ? 'updated' : 'created'}: ${saved.namespace}`,
      operator: 'system-service',
    });
    return this.getNamespace(saved.namespace);
  }

  async removeNamespace(namespace: string): Promise<DictionaryNamespaceRecord> {
    DictionaryUtil.assertRequired('namespace', namespace);
    const normalizedNamespace = namespace.trim();
    const entity = await this.namespaceService.findByNamespace(normalizedNamespace);
    if (!entity) {
      throw new ProjectException(`Dictionary namespace not found: ${normalizedNamespace}`);
    }

    const aggregateCount = await this.aggregateService.repo.count({
      where: { namespace: normalizedNamespace },
    });
    if (aggregateCount > 0) {
      throw new ProjectException(`Dictionary namespace is not empty: ${normalizedNamespace}`);
    }

    const removed = this.toNamespaceRecord(entity);
    await this.namespaceService.delete(entity.id);
    await this.operationLogService.log({
      module: 'dictionary',
      action: 'namespace-delete',
      targetType: 'namespace',
      targetId: normalizedNamespace,
      summary: `Dictionary namespace deleted: ${normalizedNamespace}`,
      operator: 'system-service',
    });
    return removed;
  }

  async listAggregates(
    query: DictionaryAggregateQueryForm,
  ): Promise<PageResult<DictionaryAggregateRecord>> {
    DictionaryUtil.assertRequired('namespace', query.namespace);
    const normalizedNamespace = query.namespace.trim();
    const items = await this.repository.find({
      where: { namespace: normalizedNamespace },
      order: { aggregateKey: 'ASC', updatedAt: 'DESC' },
    });
    const summaryMap = this.buildAggregateSummaryMap(items);
    return this.aggregateService.listWithSummary(normalizedNamespace, query, summaryMap);
  }

  async getAggregate(namespace: string, aggregateKey: string): Promise<DictionaryAggregateRecord> {
    DictionaryUtil.assertRequired('namespace', namespace);
    DictionaryUtil.assertRequired('aggregateKey', aggregateKey);
    const normalizedNamespace = namespace.trim();
    const normalizedAggregateKey = aggregateKey.trim();
    const entity = await this.aggregateService.findByKey(
      normalizedNamespace,
      normalizedAggregateKey,
    );
    if (!entity) {
      throw new ProjectException(
        `Dictionary aggregate not found: ${normalizedNamespace}.${normalizedAggregateKey}`,
      );
    }
    const items = await this.repository.find({
      where: {
        namespace: normalizedNamespace,
        aggregateKey: normalizedAggregateKey,
      },
    });
    return this.toAggregateRecord(entity, this.buildAggregateSummaryMap(items));
  }

  async upsertAggregate(
    namespace: string,
    aggregateKey: string,
    payload: Partial<DictionaryAggregateRecord>,
  ): Promise<DictionaryAggregateRecord> {
    DictionaryUtil.assertRequired('namespace', namespace);
    DictionaryUtil.assertRequired('aggregateKey', aggregateKey);
    const normalizedNamespace = namespace.trim();
    const normalizedAggregateKey = aggregateKey.trim();
    await this.ensureNamespaceExists(normalizedNamespace);
    const current = await this.aggregateService.findByKey(
      normalizedNamespace,
      normalizedAggregateKey,
    );
    const entityPayload: Partial<DictionaryAggregateItem> = {
      label:
        payload.label !== undefined
          ? (DictionaryUtil.normalizeOptionalString(payload.label) ?? null)
          : (current?.label ?? null),
      description:
        payload.description !== undefined
          ? (DictionaryUtil.normalizeOptionalString(payload.description) ?? null)
          : (current?.description ?? null),
      isEnabled: payload.isEnabled ?? current?.isEnabled ?? true,
    };

    let saved: DictionaryAggregateItem;
    if (current) {
      saved =
        (await this.aggregateService.createOrUpdate(current.id, entityPayload)) ??
        (await this.aggregateService.create({
          namespace: normalizedNamespace,
          aggregateKey: normalizedAggregateKey,
          ...entityPayload,
        }));
    } else {
      saved = await this.aggregateService.create({
        namespace: normalizedNamespace,
        aggregateKey: normalizedAggregateKey,
        ...entityPayload,
      });
    }

    await this.operationLogService.log({
      module: 'dictionary',
      action: current ? 'aggregate-update' : 'aggregate-create',
      targetType: 'aggregate',
      targetId: `${normalizedNamespace}.${normalizedAggregateKey}`,
      summary: `Dictionary aggregate ${current ? 'updated' : 'created'}: ${normalizedNamespace}.${normalizedAggregateKey}`,
      operator: 'system-service',
    });
    return this.getAggregate(saved.namespace, saved.aggregateKey);
  }

  async removeAggregate(
    namespace: string,
    aggregateKey: string,
  ): Promise<DictionaryAggregateRecord> {
    DictionaryUtil.assertRequired('namespace', namespace);
    DictionaryUtil.assertRequired('aggregateKey', aggregateKey);
    const normalizedNamespace = namespace.trim();
    const normalizedAggregateKey = aggregateKey.trim();
    const entity = await this.aggregateService.findByKey(
      normalizedNamespace,
      normalizedAggregateKey,
    );
    if (!entity) {
      throw new ProjectException(
        `Dictionary aggregate not found: ${normalizedNamespace}.${normalizedAggregateKey}`,
      );
    }
    const itemCount = await this.repository.count({
      where: {
        namespace: normalizedNamespace,
        aggregateKey: normalizedAggregateKey,
      },
    });
    if (itemCount > 0) {
      throw new ProjectException(
        `Dictionary aggregate is not empty: ${normalizedNamespace}.${normalizedAggregateKey}`,
      );
    }
    const removed = this.toAggregateRecord(entity, new Map());
    await this.aggregateService.delete(entity.id);
    await this.operationLogService.log({
      module: 'dictionary',
      action: 'aggregate-delete',
      targetType: 'aggregate',
      targetId: `${normalizedNamespace}.${normalizedAggregateKey}`,
      summary: `Dictionary aggregate deleted: ${normalizedNamespace}.${normalizedAggregateKey}`,
      operator: 'system-service',
    });
    return removed;
  }

  async listItems(query: DictionaryItemsQueryForm): Promise<DictionaryRecord[]> {
    DictionaryUtil.assertRequired('namespace', query.namespace);
    DictionaryUtil.assertRequired('aggregateKey', query.aggregateKey);
    const normalizedNamespace = query.namespace.trim();
    const normalizedAggregateKey = query.aggregateKey.trim();
    const normalizedKeys = DictionaryService.normalizeKeys(query.keys);
    const items = await this.repository.find({
      where: {
        namespace: normalizedNamespace,
        aggregateKey: normalizedAggregateKey,
        ...(normalizedKeys.length ? { key: In(normalizedKeys) } : {}),
      },
      order: PaginationUtil.buildOrder(query, {
        allowedSortFields: ['id', 'namespace', 'aggregateKey', 'key', 'createdAt', 'updatedAt'],
        defaultOrder: { key: 'ASC' },
      }),
    });

    return items.map((item) => this.toRecord(item));
  }

  async listRuntimeItems(query: DictionaryItemsQueryForm): Promise<DictionaryRecord[]> {
    const normalizedNamespace = query.namespace.trim();
    const normalizedAggregateKey = query.aggregateKey.trim();
    const namespace = await this.namespaceService.repo.findOne({
      where: { namespace: normalizedNamespace },
    });
    const aggregate = await this.aggregateService.repo.findOne({
      where: {
        namespace: normalizedNamespace,
        aggregateKey: normalizedAggregateKey,
      },
    });
    if (!namespace?.isEnabled || !aggregate?.isEnabled) {
      return [];
    }

    const items = await this.findItems({
      namespace: normalizedNamespace,
      aggregateKey: normalizedAggregateKey,
      keys: query.keys,
      enabledOnly: true,
    });
    return items.map((item) => this.toRecord(item));
  }

  async getItem(input: DictionaryItemKey | DictionaryItemQuery): Promise<DictionaryRecord> {
    const { namespace, aggregateKey, key } = this.normalizeItemKey(input as DictionaryItemKey);
    const item = await this.repository.findOne({
      where: {
        namespace,
        aggregateKey,
        key,
        ...((input as DictionaryItemQuery).enabledOnly ? { isEnabled: true } : {}),
      },
    });
    if (!item) {
      throw new ProjectException(`Dictionary item not found: ${namespace}.${aggregateKey}.${key}`);
    }

    return this.toRecord(item);
  }

  async upsertItem(
    input: DictionaryItemKey,
    payload: Partial<DictionaryImportItem>,
  ): Promise<DictionaryRecord> {
    const { namespace, aggregateKey, key } = this.normalizeItemKey(input);
    await this.ensureAggregateExists(namespace, aggregateKey);

    const current = await this.repository.findOne({
      where: { namespace, aggregateKey, key },
    });

    const itemPayload: Partial<DictionaryItem> = {
      namespace,
      aggregateKey,
      key,
      value: payload.value ?? current?.value ?? null,
      label:
        payload.label !== undefined
          ? (DictionaryUtil.normalizeOptionalString(payload.label) ?? null)
          : (current?.label ?? null),
      description:
        payload.description !== undefined
          ? (DictionaryUtil.normalizeOptionalString(payload.description) ?? null)
          : (current?.description ?? null),
      isEnabled: payload.isEnabled ?? current?.isEnabled ?? true,
    };

    let saved: DictionaryItem | null;
    if (current) {
      saved = await this.update(current.id, itemPayload);
    } else {
      saved = await this.create(itemPayload);
    }

    if (!saved) {
      throw new ProjectException(
        `Dictionary item not found after save: ${namespace}.${aggregateKey}.${key}`,
      );
    }
    this.logger.log(`Dictionary upserted: ${namespace}.${aggregateKey}.${key}`);
    await this.operationLogService.log({
      module: 'dictionary',
      action: current ? 'item-update' : 'item-create',
      targetType: 'item',
      targetId: `${namespace}.${aggregateKey}.${key}`,
      summary: `Dictionary item ${current ? 'updated' : 'created'}: ${namespace}.${aggregateKey}.${key}`,
      operator: 'system-service',
    });
    return this.toRecord(saved);
  }

  async removeItem(input: DictionaryItemKey): Promise<DictionaryRecord> {
    const { namespace, aggregateKey, key } = this.normalizeItemKey(input);
    const removed = await this.repository.findOne({
      where: { namespace, aggregateKey, key },
    });
    if (!removed) {
      throw new ProjectException(`Dictionary item not found: ${namespace}.${aggregateKey}.${key}`);
    }

    await this.delete(removed.id);
    await this.operationLogService.log({
      module: 'dictionary',
      action: 'item-delete',
      targetType: 'item',
      targetId: `${namespace}.${aggregateKey}.${key}`,
      summary: `Dictionary item deleted: ${namespace}.${aggregateKey}.${key}`,
      operator: 'system-service',
    });
    return this.toRecord(removed);
  }

  async importNamespace(
    namespace: string,
    items: DictionaryImportItem[],
    options?: { label?: string; description?: string },
  ): Promise<DictionaryImportResult> {
    DictionaryUtil.assertRequired('namespace', namespace);
    const normalizedNamespace = namespace.trim();
    await this.ensureNamespaceExists(normalizedNamespace, options);

    const normalizedItems = DictionaryUtil.normalizeImportItems(items);
    const imported: DictionaryRecord[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    const skippedCount = items.length - normalizedItems.length;

    for (const item of normalizedItems) {
      const existing = await this.repository.findOne({
        where: {
          namespace: normalizedNamespace,
          aggregateKey: item.aggregateKey,
          key: item.key,
        },
      });
      imported.push(
        await this.upsertItem(
          {
            namespace: normalizedNamespace,
            aggregateKey: item.aggregateKey,
            key: item.key,
          },
          item,
        ),
      );
      if (existing) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }
    }

    const result = {
      namespace: normalizedNamespace,
      importedCount: imported.length,
      createdCount,
      updatedCount,
      skippedCount,
      items: imported,
    };
    this.logger.log(
      `Dictionary namespace imported: ${normalizedNamespace}, created=${createdCount}, updated=${updatedCount}, skipped=${skippedCount}`,
    );
    await this.operationLogService.log({
      module: 'dictionary',
      action: 'namespace-import',
      targetType: 'namespace',
      targetId: normalizedNamespace,
      summary: `Dictionary namespace imported: ${normalizedNamespace} (${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped)`,
      operator: 'system-service',
    });
    return result;
  }

  private buildNamespaceSummaryMap(items: DictionaryItem[]) {
    const summaryMap = new Map<string, { count: number; updatedAt: Date | undefined }>();
    for (const item of items) {
      const current = summaryMap.get(item.namespace);
      summaryMap.set(item.namespace, {
        count: (current?.count ?? 0) + 1,
        updatedAt:
          !current?.updatedAt || current.updatedAt < item.updatedAt
            ? item.updatedAt
            : current.updatedAt,
      });
    }
    return summaryMap;
  }

  private buildAggregateSummaryMap(items: DictionaryItem[]) {
    const summaryMap = new Map<string, { count: number; updatedAt: Date | undefined }>();
    for (const item of items) {
      const mapKey = `${item.namespace}:${item.aggregateKey}`;
      const current = summaryMap.get(mapKey);
      summaryMap.set(mapKey, {
        count: (current?.count ?? 0) + 1,
        updatedAt:
          !current?.updatedAt || current.updatedAt < item.updatedAt
            ? item.updatedAt
            : current.updatedAt,
      });
    }
    return summaryMap;
  }

  private async findItems(input: DictionaryItemsLookup) {
    DictionaryUtil.assertRequired('namespace', input.namespace);
    DictionaryUtil.assertRequired('aggregateKey', input.aggregateKey);
    const namespace = input.namespace.trim();
    const aggregateKey = input.aggregateKey.trim();
    const normalizedKeys = DictionaryService.normalizeKeys(input.keys);
    return this.repository.find({
      where: {
        namespace,
        aggregateKey,
        ...(normalizedKeys.length ? { key: In(normalizedKeys) } : {}),
        ...(input.enabledOnly ? { isEnabled: true } : {}),
      },
      order: { key: 'ASC' },
    });
  }

  private normalizeItemKey(input: DictionaryItemKey): DictionaryItemKey {
    DictionaryUtil.assertRequired('namespace', input.namespace);
    DictionaryUtil.assertRequired('aggregateKey', input.aggregateKey);
    DictionaryUtil.assertRequired('key', input.key);
    return {
      namespace: input.namespace.trim(),
      aggregateKey: input.aggregateKey.trim(),
      key: input.key.trim(),
    };
  }

  private static normalizeKeys(keys?: string[]) {
    return [...new Set((keys ?? []).map((key) => key.trim()).filter((key) => !!key))];
  }

  private async ensureNamespaceExists(
    namespace: string,
    options?: { label?: string; description?: string },
  ): Promise<DictionaryNamespaceItem> {
    const current = await this.namespaceService.findByNamespace(namespace);
    if (current) {
      return current;
    }

    return this.namespaceService.create({
      namespace,
      label: DictionaryUtil.normalizeOptionalString(options?.label) ?? namespace,
      description: DictionaryUtil.normalizeOptionalString(options?.description) ?? null,
      isEnabled: true,
    });
  }

  private async ensureAggregateExists(
    namespace: string,
    aggregateKey: string,
    options?: { label?: string; description?: string },
  ): Promise<DictionaryAggregateItem> {
    const current = await this.aggregateService.findByKey(namespace, aggregateKey);
    if (current) {
      return current;
    }
    await this.ensureNamespaceExists(namespace);
    return this.aggregateService.create({
      namespace,
      aggregateKey,
      label: DictionaryUtil.normalizeOptionalString(options?.label) ?? aggregateKey,
      description: DictionaryUtil.normalizeOptionalString(options?.description) ?? null,
      isEnabled: true,
    });
  }

  private toNamespaceRecord(entity: DictionaryNamespaceItem): DictionaryNamespaceRecord {
    return {
      id: entity.id,
      namespace: entity.namespace,
      label: entity.label ?? undefined,
      description: entity.description ?? undefined,
      isEnabled: entity.isEnabled,
      count: 0,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private toAggregateRecord(
    entity: DictionaryAggregateItem,
    summaryMap: Map<string, { count: number; updatedAt: Date | undefined }>,
  ): DictionaryAggregateRecord {
    const summary = summaryMap.get(`${entity.namespace}:${entity.aggregateKey}`);
    return {
      id: entity.id,
      namespace: entity.namespace,
      aggregateKey: entity.aggregateKey,
      label: entity.label ?? undefined,
      description: entity.description ?? undefined,
      isEnabled: entity.isEnabled,
      count: summary?.count ?? 0,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: (summary?.updatedAt ?? entity.updatedAt).toISOString(),
    };
  }

  private toRecord(entity: DictionaryItem): DictionaryRecord {
    return {
      id: entity.id,
      namespace: entity.namespace,
      aggregateKey: entity.aggregateKey,
      key: entity.key,
      value: entity.value,
      label: entity.label ?? undefined,
      description: entity.description ?? undefined,
      isEnabled: entity.isEnabled,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
