import { BaseService } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { PageResult } from '../../../utils/pagination.types';
import { PaginationUtil } from '../../../utils/pagination.util';
import { DictionaryNamespaceItem } from '../entity/dictionary-namespace.entity';
import { DictionaryNamespaceQueryForm } from '../form/dictionary-namespace-query.form';
import { DictionaryNamespaceRecord } from '../dictionary.types';

@Injectable()
export class DictionaryNamespaceService extends BaseService<DictionaryNamespaceItem> {
  constructor(
    @InjectRepository(DictionaryNamespaceItem)
    protected readonly repository: Repository<DictionaryNamespaceItem>,
  ) {
    super(repository);
  }

  /** 公开 repository 供外部查询 */
  get repo(): Repository<DictionaryNamespaceItem> {
    return this.repository;
  }

  /** 如果 entity 存在则更新，否则创建 */
  async createOrUpdate(
    id: number | undefined,
    data: Partial<DictionaryNamespaceItem>,
  ): Promise<DictionaryNamespaceItem | null> {
    if (id) {
      return this.update(id, data);
    }
    return this.create(data as any);
  }

  async listWithSummary(
    query: DictionaryNamespaceQueryForm,
    itemCountByNamespace: Map<string, { count: number; updatedAt: Date | undefined }>,
  ): Promise<PageResult<DictionaryNamespaceRecord>> {
    const pageQuery = PaginationUtil.normalizePageQuery(query);
    const baseWhere: FindOptionsWhere<DictionaryNamespaceItem> =
      query.isEnabled !== undefined ? { isEnabled: query.isEnabled } : {};
    const [items, total] = await this.repository.findAndCount({
      where: this.buildWhere(baseWhere, query.keyword),
      order: PaginationUtil.buildOrder(query, {
        allowedSortFields: ['id', 'namespace', 'createdAt', 'updatedAt'],
        defaultOrder: { namespace: 'ASC' },
      }),
      skip: pageQuery.skip,
      take: pageQuery.take,
    });

    return PaginationUtil.buildPageResult(
      items.map((item) => this.toRecord(item, itemCountByNamespace.get(item.namespace))),
      total,
      pageQuery,
    );
  }

  async findByNamespace(namespace: string): Promise<DictionaryNamespaceItem | null> {
    return this.repository.findOne({ where: { namespace: namespace.trim() } });
  }

  private buildWhere(
    baseWhere: FindOptionsWhere<DictionaryNamespaceItem>,
    keyword?: string,
  ): FindOptionsWhere<DictionaryNamespaceItem>[] {
    if (!keyword) {
      return [baseWhere];
    }
    const keywordLike = ILike(`%${keyword}%`);
    return [
      { ...baseWhere, namespace: keywordLike },
      { ...baseWhere, label: keywordLike },
      { ...baseWhere, description: keywordLike },
    ];
  }

  private toRecord(
    entity: DictionaryNamespaceItem,
    summary?: { count: number; updatedAt: Date | undefined },
  ): DictionaryNamespaceRecord {
    return {
      id: entity.id,
      namespace: entity.namespace,
      label: entity.label ?? undefined,
      description: entity.description ?? undefined,
      isEnabled: entity.isEnabled,
      count: summary?.count ?? 0,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: (summary?.updatedAt ?? entity.updatedAt).toISOString(),
    };
  }
}
