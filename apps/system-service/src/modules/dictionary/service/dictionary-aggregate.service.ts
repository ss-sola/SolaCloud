import { BaseService } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { PageResult } from '../../../utils/pagination.types';
import { PaginationUtil } from '../../../utils/pagination.util';
import { DictionaryAggregateItem } from '../entity/dictionary-aggregate.entity';
import { DictionaryAggregateQueryForm } from '../form/dictionary-aggregate-query.form';
import { DictionaryAggregateRecord } from '../dictionary.types';

@Injectable()
export class DictionaryAggregateService extends BaseService<DictionaryAggregateItem> {
  constructor(
    @InjectRepository(DictionaryAggregateItem)
    protected readonly repository: Repository<DictionaryAggregateItem>,
  ) {
    super(repository);
  }

  /** 公开 repository 供外部查询 */
  get repo(): Repository<DictionaryAggregateItem> {
    return this.repository;
  }

  /** 如果 entity 存在则更新，否则创建 */
  async createOrUpdate(
    id: number | undefined,
    data: Partial<DictionaryAggregateItem>,
  ): Promise<DictionaryAggregateItem | null> {
    if (id) {
      return this.update(id, data);
    }
    return this.create(data as any);
  }

  async listWithSummary(
    namespace: string,
    query: DictionaryAggregateQueryForm,
    itemCountByAggregate: Map<string, { count: number; updatedAt: Date | undefined }>,
  ): Promise<PageResult<DictionaryAggregateRecord>> {
    const pageQuery = PaginationUtil.normalizePageQuery(query);
    const baseWhere: FindOptionsWhere<DictionaryAggregateItem> = {
      namespace,
      ...(query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {}),
    };
    const [items, total] = await this.repository.findAndCount({
      where: this.buildWhere(baseWhere, query.keyword),
      order: PaginationUtil.buildOrder(query, {
        allowedSortFields: ['id', 'aggregateKey', 'createdAt', 'updatedAt'],
        defaultOrder: { aggregateKey: 'ASC' },
      }),
      skip: pageQuery.skip,
      take: pageQuery.take,
    });

    return PaginationUtil.buildPageResult(
      items.map((item) =>
        this.toRecord(item, itemCountByAggregate.get(`${item.namespace}:${item.aggregateKey}`)),
      ),
      total,
      pageQuery,
    );
  }

  async findByKey(
    namespace: string,
    aggregateKey: string,
  ): Promise<DictionaryAggregateItem | null> {
    return this.repository.findOne({
      where: { namespace: namespace.trim(), aggregateKey: aggregateKey.trim() },
    });
  }

  private buildWhere(
    baseWhere: FindOptionsWhere<DictionaryAggregateItem>,
    keyword?: string,
  ): FindOptionsWhere<DictionaryAggregateItem>[] {
    if (!keyword) {
      return [baseWhere];
    }
    const keywordLike = ILike(`%${keyword}%`);
    return [
      { ...baseWhere, aggregateKey: keywordLike },
      { ...baseWhere, label: keywordLike },
      { ...baseWhere, description: keywordLike },
    ];
  }

  private toRecord(
    entity: DictionaryAggregateItem,
    summary?: { count: number; updatedAt: Date | undefined },
  ): DictionaryAggregateRecord {
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
}
