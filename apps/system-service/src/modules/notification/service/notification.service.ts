import { BaseService, ProjectException } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsWhere,
  ILike,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { SYSTEM_SERVICE_NAME } from '../../../system-service.constants';
import { PaginationUtil } from '../../../utils/pagination.util';
import { AccountItem } from '../../account/entity/account.entity';
import { AccountService } from '../../account/service/account.service';
import { NOTIFICATION_CAPABILITIES } from '../notification.constants';
import { AnnouncementItem } from '../entity/announcement.entity';
import { StationMessageItem } from '../entity/station-message.entity';
import { AnnouncementQueryForm } from '../form/announcement-query.form';
import { StationMessageQueryForm } from '../form/station-message-query.form';
import { AnnouncementMutationInput, StationMessageInput } from '../notification.types';

@Injectable()
export class NotificationService extends BaseService<AnnouncementItem> {
  constructor(
    @InjectRepository(AnnouncementItem)
    announcementRepo: Repository<AnnouncementItem>,
    private readonly accountService: AccountService,
  ) {
    super(announcementRepo);
  }

  async getOverview() {
    return {
      service: SYSTEM_SERVICE_NAME,
      announcementCount: await this.repository.count(),
      messageCount: await this.messageRepository.count(),
      capabilities: [...NOTIFICATION_CAPABILITIES],
    };
  }

  async listAnnouncements(query: AnnouncementQueryForm) {
    const pageQuery = PaginationUtil.normalizePageQuery(query);
    const baseWhere: FindOptionsWhere<AnnouncementItem> =
      query.isPublished !== undefined ? { isPublished: query.isPublished } : {};
    const [items, total] = await this.repository.findAndCount({
      where: this.buildAnnouncementWhere(baseWhere, query.keyword),
      order: PaginationUtil.buildOrder(query, {
        allowedSortFields: ['id', 'publishedAt', 'effectiveFrom', 'createdAt'],
        defaultOrder: { id: 'DESC' },
      }),
      skip: pageQuery.skip,
      take: pageQuery.take,
    });
    return PaginationUtil.buildPageResult(
      items.map((item) => this.toAnnouncementRecord(item)),
      total,
      pageQuery,
    );
  }

  async getAnnouncement(id: number) {
    return this.toAnnouncementRecord(await this.findAnnouncement(id));
  }

  async saveAnnouncement(input: AnnouncementMutationInput, id?: number) {
    const current = id ? await this.findAnnouncement(id) : undefined;
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : null;
    const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
    this.assertEffectiveWindow(effectiveFrom, effectiveTo);
    const isPublished = input.isPublished ?? current?.isPublished ?? false;

    const payload: Partial<AnnouncementItem> = {
      title: input.title.trim(),
      content: input.content.trim(),
      isPublished,
      effectiveFrom,
      effectiveTo,
      publishedAt: isPublished
        ? (current?.publishedAt ?? new Date())
        : (current?.publishedAt ?? null),
      revokedAt: isPublished
        ? null
        : input.isPublished === false
          ? new Date()
          : (current?.revokedAt ?? null),
      publisherAccountId: isPublished
        ? (input.publisherAccountId ?? current?.publisherAccountId ?? null)
        : (current?.publisherAccountId ?? null),
    };

    if (current) {
      const saved = await this.update(current.id, payload);
      if (!saved) {
        throw new ProjectException(`Announcement not found: ${id}`);
      }
      return this.toAnnouncementRecord(saved);
    }
    return this.toAnnouncementRecord(await this.create(payload));
  }

  async removeAnnouncement(id: number) {
    const current = await this.findAnnouncement(id);
    const record = this.toAnnouncementRecord(current);
    await this.delete(id);
    return record;
  }

  async listRuntimeAnnouncements() {
    const now = new Date();
    const activeWhere = {
      isPublished: true,
      revokedAt: IsNull(),
    };
    const items = await this.repository.find({
      where: [
        { ...activeWhere, effectiveFrom: IsNull(), effectiveTo: IsNull() },
        {
          ...activeWhere,
          effectiveFrom: IsNull(),
          effectiveTo: MoreThanOrEqual(now),
        },
        {
          ...activeWhere,
          effectiveFrom: LessThanOrEqual(now),
          effectiveTo: IsNull(),
        },
        {
          ...activeWhere,
          effectiveFrom: LessThanOrEqual(now),
          effectiveTo: MoreThanOrEqual(now),
        },
      ],
      order: { id: 'DESC' },
    });
    return items.map((item) => this.toAnnouncementRecord(item));
  }

  async sendMessages(input: StationMessageInput) {
    const receiverAccountIds = await this.resolveReceiverAccountIds(input);
    if (!receiverAccountIds.length) {
      throw new ProjectException('Station message receivers required');
    }
    const items = receiverAccountIds.map((receiverAccountId) =>
      this.messageRepository.create({
        title: input.title.trim(),
        content: input.content.trim(),
        receiverAccountId,
        senderAccountId: input.senderAccountId ?? null,
        isRead: false,
      }),
    );
    const savedItems = await this.messageRepository.save(items);
    return savedItems.map((item) => this.toMessageRecord(item));
  }

  async listMessages(query: StationMessageQueryForm) {
    const pageQuery = PaginationUtil.normalizePageQuery(query);
    const [items, total] = await this.messageRepository.findAndCount({
      where: {
        ...(query.receiverAccountId ? { receiverAccountId: query.receiverAccountId } : {}),
        ...(query.isRead !== undefined ? { isRead: query.isRead } : {}),
      },
      order: PaginationUtil.buildOrder(query, {
        allowedSortFields: ['id', 'createdAt', 'readAt'],
        defaultOrder: { id: 'DESC' },
      }),
      skip: pageQuery.skip,
      take: pageQuery.take,
    });
    return PaginationUtil.buildPageResult(
      items.map((item) => this.toMessageRecord(item)),
      total,
      pageQuery,
    );
  }

  async listRuntimeMessages(accountId: number, isRead?: boolean) {
    const items = await this.messageRepository.find({
      where: {
        receiverAccountId: accountId,
        ...(isRead !== undefined ? { isRead } : {}),
      },
      order: { id: 'DESC' },
    });
    return items.map((item) => this.toMessageRecord(item));
  }

  async unreadCount(accountId: number) {
    return this.messageRepository.count({
      where: { receiverAccountId: accountId, isRead: false },
    });
  }

  async markRead(id: number, receiverAccountId?: number) {
    if (!receiverAccountId) {
      throw new ProjectException('Station message receiver required');
    }
    const item = await this.messageRepository.findOne({
      where: { id, receiverAccountId },
    });
    if (!item) {
      throw new ProjectException(`Station message not found: ${id}`);
    }
    item.isRead = true;
    item.readAt = item.readAt ?? new Date();
    return this.toMessageRecord(await this.messageRepository.save(item));
  }

  async markAllRead(accountId: number) {
    const unreadItems = await this.messageRepository.find({
      where: { receiverAccountId: accountId, isRead: false },
      order: { id: 'DESC' },
    });
    if (!unreadItems.length) {
      return { updatedCount: 0, items: [] };
    }
    const savedItems = await this.messageRepository.save(
      unreadItems.map((item) => {
        item.isRead = true;
        item.readAt = item.readAt ?? new Date();
        return item;
      }),
    );
    return {
      updatedCount: savedItems.length,
      items: savedItems.map((item) => this.toMessageRecord(item)),
    };
  }

  private buildAnnouncementWhere(
    baseWhere: FindOptionsWhere<AnnouncementItem>,
    keyword?: string,
  ): FindOptionsWhere<AnnouncementItem>[] {
    if (!keyword) {
      return [baseWhere];
    }

    const keywordLike = ILike(`%${keyword}%`);
    return [
      { ...baseWhere, title: keywordLike },
      { ...baseWhere, content: keywordLike },
    ];
  }

  private async findAnnouncement(id: number) {
    const item = await this.findOne(id);
    if (!item) {
      throw new ProjectException(`Announcement not found: ${id}`);
    }
    return item;
  }

  private assertEffectiveWindow(effectiveFrom?: Date | null, effectiveTo?: Date | null) {
    if (effectiveFrom && effectiveTo && effectiveFrom.getTime() > effectiveTo.getTime()) {
      throw new ProjectException('Announcement effectiveFrom must be before effectiveTo');
    }
  }

  private async resolveReceiverAccountIds(input: StationMessageInput) {
    if (input.isBroadcast) {
      const items = await this.accountService.findAll({
        where: { isEnabled: true } as FindOptionsWhere<AccountItem>,
        order: { id: 'ASC' },
      });
      return items.map((item) => item.id);
    }
    return [...new Set(input.receiverAccountIds ?? [])];
  }

  private toAnnouncementRecord(item: AnnouncementItem) {
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      isPublished: item.isPublished,
      effectiveFrom: item.effectiveFrom?.toISOString(),
      effectiveTo: item.effectiveTo?.toISOString(),
      publishedAt: item.publishedAt?.toISOString(),
      revokedAt: item.revokedAt?.toISOString(),
      publisherAccountId: item.publisherAccountId ?? undefined,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toMessageRecord(item: StationMessageItem) {
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      receiverAccountId: item.receiverAccountId,
      senderAccountId: item.senderAccountId ?? undefined,
      isRead: item.isRead,
      readAt: item.readAt?.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private get messageRepository() {
    return this.repository.manager.getRepository(StationMessageItem);
  }
}
