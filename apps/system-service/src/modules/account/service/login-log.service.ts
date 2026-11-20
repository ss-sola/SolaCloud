import { BaseService } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { SYSTEM_SERVICE_NAME } from '../../../system-service.constants';
import { PaginationUtil } from '../../../utils/pagination.util';
import { LoginLogItem } from '../entity/login-log.entity';
import { LoginLogQueryForm } from '../form/login-log-query.form';
import { LoginLogInput } from '../account.types';

@Injectable()
export class LoginLogService extends BaseService<LoginLogItem> {
  constructor(
    @InjectRepository(LoginLogItem)
    private readonly loginLogRepo: Repository<LoginLogItem>,
  ) {
    super(loginLogRepo);
  }

  async getOverview() {
    return {
      service: SYSTEM_SERVICE_NAME,
      itemCount: await this.repository.count(),
      capabilities: ['security-event-query'],
    };
  }

  async listItems(query: LoginLogQueryForm) {
    const pageQuery = PaginationUtil.normalizePageQuery(query);
    const where: FindOptionsWhere<LoginLogItem> = {
      ...(query.accountName ? { accountName: query.accountName } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.success !== undefined ? { success: query.success } : {}),
    };
    const [items, total] = await this.repository.findAndCount({
      where,
      order: PaginationUtil.buildOrder(query, {
        allowedSortFields: ['id', 'createdAt'],
        defaultOrder: { id: 'DESC' },
      }),
      skip: pageQuery.skip,
      take: pageQuery.take,
    });
    return PaginationUtil.buildPageResult(
      items.map((item) => ({
        id: item.id,
        accountId: item.accountId ?? undefined,
        accountName: item.accountName,
        eventType: item.eventType,
        success: item.success,
        message: item.message,
        ip: item.ip ?? undefined,
        userAgent: item.userAgent ?? undefined,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      total,
      pageQuery,
    );
  }

  async log(input: LoginLogInput) {
    return this.create({
      accountId: input.accountId ?? null,
      accountName: input.accountName,
      eventType: input.eventType,
      success: input.success,
      message: input.message,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  }
}
