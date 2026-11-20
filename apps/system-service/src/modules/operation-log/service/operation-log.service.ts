import { BaseService } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SYSTEM_SERVICE_NAME } from '../../../system-service.constants';
import { PageResult } from '../../../utils/pagination.types';
import { PaginationUtil } from '../../../utils/pagination.util';
import { OPERATION_LOG_CAPABILITIES } from '../operation-log.constants';
import { OperationLogItem } from '../entity/operation-log.entity';
import { OperationLogQueryForm } from '../form/operation-log-query.form';
import { OperationLogInput, OperationLogRecord } from '../operation-log.types';

@Injectable()
export class OperationLogService extends BaseService<OperationLogItem> {
  private readonly logger = new Logger(OperationLogService.name);

  constructor(
    @InjectRepository(OperationLogItem)
    protected readonly repository: Repository<OperationLogItem>,
  ) {
    super(repository);
  }

  async getOverview() {
    return {
      service: SYSTEM_SERVICE_NAME,
      itemCount: await this.repository.count(),
      capabilities: [...OPERATION_LOG_CAPABILITIES],
    };
  }

  async listItems(query: OperationLogQueryForm): Promise<PageResult<OperationLogRecord>> {
    const pageQuery = PaginationUtil.normalizePageQuery(query);
    const [items, total] = await this.repository.findAndCount({
      where: {
        ...(query.module ? { module: query.module } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.operator ? { operator: query.operator } : {}),
      },
      order: PaginationUtil.buildOrder(query, {
        allowedSortFields: ['id', 'module', 'createdAt'],
        defaultOrder: { id: 'DESC' },
      }),
      skip: pageQuery.skip,
      take: pageQuery.take,
    });

    return PaginationUtil.buildPageResult(
      items.map((item) => this.toRecord(item)),
      total,
      pageQuery,
    );
  }

  async log(payload: OperationLogInput): Promise<OperationLogRecord> {
    const saved = await this.create({
      module: payload.module.trim(),
      action: payload.action.trim(),
      targetType: payload.targetType.trim(),
      targetId: payload.targetId?.trim() || null,
      summary: payload.summary.trim(),
      operator: payload.operator?.trim() || null,
    });
    this.logger.log(`Operation logged: ${saved.module}.${saved.action} -> ${saved.targetType}`);
    return this.toRecord(saved);
  }

  private toRecord(entity: OperationLogItem): OperationLogRecord {
    return {
      id: entity.id,
      module: entity.module,
      action: entity.action,
      targetType: entity.targetType,
      targetId: entity.targetId ?? undefined,
      summary: entity.summary,
      operator: entity.operator ?? undefined,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
