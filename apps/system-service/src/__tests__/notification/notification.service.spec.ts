import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { AccountItem } from '@/modules/account/entity/account.entity';
import { AccountService } from '@/modules/account/service/account.service';
import { AnnouncementItem } from '@/modules/notification/entity/announcement.entity';
import { StationMessageItem } from '@/modules/notification/entity/station-message.entity';
import { NotificationService } from '@/modules/notification/service/notification.service';

type MockRepository<T extends object> = Partial<Record<keyof Repository<T>, any>>;

type NotificationServiceContext = ReturnType<typeof createService>;

function createService() {
  const announcements = new Map<number, AnnouncementItem>();
  const messages = new Map<number, StationMessageItem>();
  const accounts = new Map<number, AccountItem>();
  let announcementSequence = 1;
  let messageSequence = 1;

  const announcementRepository: MockRepository<AnnouncementItem> = {
    count: vi.fn(() => Promise.resolve(announcements.size)),
    findOne: vi.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        [...announcements.values()].find((item) => matchesWhere(item, where)) ?? null,
      ),
    ),
    find: vi.fn((options?: { where?: Record<string, unknown> | Record<string, unknown>[] }) => {
      let values = [...announcements.values()];
      if (options?.where) {
        values = values.filter((item) => matchesWhere(item, options.where!));
      }
      return Promise.resolve(values.sort((left, right) => right.id - left.id));
    }),
    create: vi.fn((input: Partial<AnnouncementItem>) =>
      createAnnouncementItem({ input, id: announcementSequence }),
    ),
    save: vi.fn((entity: AnnouncementItem) => {
      if (!entity.id) {
        entity.id = announcementSequence;
      }
      if (entity.id === announcementSequence) {
        announcementSequence += 1;
      }
      entity.updatedAt = new Date('2026-05-29T08:00:00.000Z');
      announcements.set(entity.id, entity);
      return Promise.resolve(entity);
    }),
    remove: vi.fn((entity: AnnouncementItem) => {
      announcements.delete(entity.id);
      return Promise.resolve(entity);
    }),
    update: vi.fn((id: number, data: Partial<AnnouncementItem>) => {
      const item = announcements.get(id);
      if (item) {
        Object.assign(item, data);
      }
      return Promise.resolve({ affected: item ? 1 : 0 } as any);
    }),
    softDelete: vi.fn((id: number) => {
      announcements.delete(id);
      return Promise.resolve({ affected: 1 } as any);
    }),
  };

  const messageRepository: MockRepository<StationMessageItem> = {
    count: vi.fn((options?: { where?: Record<string, unknown> }) => {
      if (!options?.where) {
        return Promise.resolve(messages.size);
      }
      return Promise.resolve(
        [...messages.values()].filter((item) => matchesWhere(item, options.where!)).length,
      );
    }),
    findOne: vi.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...messages.values()].find((item) => matchesWhere(item, where)) ?? null),
    ),
    find: vi.fn((options?: { where?: Record<string, unknown> }) => {
      let values = [...messages.values()];
      if (options?.where) {
        values = values.filter((item) => matchesWhere(item, options.where!));
      }
      return Promise.resolve(values.sort((left, right) => right.id - left.id));
    }),
    create: vi.fn((input: Partial<StationMessageItem>) =>
      createStationMessageItem({ input, id: messageSequence }),
    ),
    save: vi.fn((entityOrItems: StationMessageItem | StationMessageItem[]) => {
      const items = Array.isArray(entityOrItems) ? entityOrItems : [entityOrItems];
      const savedItems = items.map((entity) => {
        if (!entity.id) {
          entity.id = messageSequence;
        }
        if (entity.id === messageSequence) {
          messageSequence += 1;
        }
        entity.updatedAt = new Date('2026-05-29T08:00:00.000Z');
        messages.set(entity.id, entity);
        return entity;
      });
      return Promise.resolve(Array.isArray(entityOrItems) ? savedItems : savedItems[0]);
    }),
  };

  const accountRepository: MockRepository<AccountItem> = {
    find: vi.fn((options?: { where?: Record<string, unknown> }) => {
      let values = [...accounts.values()];
      if (options?.where) {
        values = values.filter((item) => matchesWhere(item, options.where!));
      }
      return Promise.resolve(values.sort((left, right) => left.id - right.id));
    }),
  };

  const repositoryMap = new Map<object, MockRepository<any>>([
    [AnnouncementItem, announcementRepository],
    [StationMessageItem, messageRepository],
    [AccountItem, accountRepository],
  ]);

  const dataSource = {
    getRepository: vi.fn((target: object) => {
      const repository = repositoryMap.get(target);
      if (!repository) {
        throw new Error(`Repository not mocked: ${String(target)}`);
      }
      return repository;
    }),
  } as unknown as DataSource;

  const mockAccountService = {
    findAll: vi.fn().mockImplementation(({ where }: any) => {
      const values = [...accounts.values()];
      if (where?.isEnabled !== undefined) {
        return Promise.resolve(values.filter((a: AccountItem) => a.isEnabled === where.isEnabled));
      }
      return Promise.resolve(values);
    }),
  } as unknown as AccountService;

  return {
    service: new NotificationService(
      {
        ...announcementRepository,
        manager: {
          getRepository: vi.fn((target: object) => {
            const repository = repositoryMap.get(target);
            if (!repository) {
              throw new Error(`Repository not mocked: ${String(target)}`);
            }
            return repository;
          }),
        },
      } as unknown as Repository<AnnouncementItem>,
      mockAccountService,
    ),
    stores: {
      announcements,
      messages,
      accounts,
    },
  };
}

function createAnnouncementItem(params: {
  input: Partial<AnnouncementItem>;
  id: number;
}): AnnouncementItem {
  return {
    id: params.input.id ?? params.id,
    title: params.input.title ?? '',
    content: params.input.content ?? '',
    isPublished: params.input.isPublished ?? false,
    effectiveFrom: params.input.effectiveFrom ?? null,
    effectiveTo: params.input.effectiveTo ?? null,
    publishedAt: params.input.publishedAt ?? null,
    revokedAt: params.input.revokedAt ?? null,
    publisherAccountId: params.input.publisherAccountId ?? null,
    createdAt: params.input.createdAt ?? new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: params.input.updatedAt ?? new Date('2026-05-29T08:00:00.000Z'),
  } as AnnouncementItem;
}

function createStationMessageItem(params: {
  input: Partial<StationMessageItem>;
  id: number;
}): StationMessageItem {
  return {
    id: params.input.id ?? params.id,
    title: params.input.title ?? '',
    content: params.input.content ?? '',
    receiverAccountId: params.input.receiverAccountId ?? 0,
    senderAccountId: params.input.senderAccountId ?? null,
    isRead: params.input.isRead ?? false,
    readAt: params.input.readAt ?? null,
    createdAt: params.input.createdAt ?? new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: params.input.updatedAt ?? new Date('2026-05-29T08:00:00.000Z'),
  } as StationMessageItem;
}

function createAccountItem(params: {
  id: number;
  accountName: string;
  displayName: string;
  isEnabled?: boolean;
}): AccountItem {
  return {
    id: params.id,
    accountName: params.accountName,
    displayName: params.displayName,
    passwordHash: 'hashed',
    isEnabled: params.isEnabled ?? true,
    failedLoginCount: 0,
    statusVersion: 1,
    createdAt: new Date('2026-05-29T08:00:00.000Z'),
    updatedAt: new Date('2026-05-29T08:00:00.000Z'),
  } as AccountItem;
}

function matchesWhere(item: object, where: Record<string, unknown> | Record<string, unknown>[]) {
  if (Array.isArray(where)) {
    return where.some((entry) => matchesWhere(item, entry));
  }

  return Object.entries(where).every(([key, value]) =>
    matchesValue((item as Record<string, unknown>)[key], value),
  );
}

function matchesValue(current: unknown, value: unknown) {
  if (value && typeof value === 'object' && '_type' in value) {
    const marker = value as { _type?: string; _value?: unknown };
    if (marker._type === 'isNull') {
      return current === null || current === undefined;
    }
    if (marker._type === 'moreThanOrEqual') {
      return current instanceof Date && marker._value instanceof Date
        ? current.getTime() >= marker._value.getTime()
        : Number(current) >= Number(marker._value);
    }
    if (marker._type === 'lessThanOrEqual') {
      return current instanceof Date && marker._value instanceof Date
        ? current.getTime() <= marker._value.getTime()
        : Number(current) <= Number(marker._value);
    }
  }
  return current === value;
}

function seedAnnouncement(
  context: NotificationServiceContext,
  input: Partial<AnnouncementItem> & {
    id: number;
    title: string;
    content: string;
  },
) {
  context.stores.announcements.set(input.id, createAnnouncementItem({ input, id: input.id }));
}

function seedMessage(
  context: NotificationServiceContext,
  input: Partial<StationMessageItem> & {
    id: number;
    title: string;
    content: string;
    receiverAccountId: number;
  },
) {
  context.stores.messages.set(input.id, createStationMessageItem({ input, id: input.id }));
}

describe('NotificationService', () => {
  let context: NotificationServiceContext;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T08:00:00.000Z'));
    context = createService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should filter runtime announcements by publish state and effective window', async () => {
    seedAnnouncement(context, {
      id: 1,
      title: '当前公告',
      content: '生效中',
      isPublished: true,
      effectiveFrom: new Date('2026-05-29T00:00:00.000Z'),
      effectiveTo: new Date('2026-05-29T23:59:59.000Z'),
      publishedAt: new Date('2026-05-29T00:00:00.000Z'),
    });
    seedAnnouncement(context, {
      id: 2,
      title: '未来公告',
      content: '未开始',
      isPublished: true,
      effectiveFrom: new Date('2026-05-30T00:00:00.000Z'),
      effectiveTo: new Date('2026-05-30T23:59:59.000Z'),
      publishedAt: new Date('2026-05-29T00:00:00.000Z'),
    });
    seedAnnouncement(context, {
      id: 3,
      title: '已撤回公告',
      content: '无效',
      isPublished: true,
      effectiveFrom: new Date('2026-05-29T00:00:00.000Z'),
      effectiveTo: new Date('2026-05-29T23:59:59.000Z'),
      revokedAt: new Date('2026-05-29T07:00:00.000Z'),
      publishedAt: new Date('2026-05-29T00:00:00.000Z'),
    });
    seedAnnouncement(context, {
      id: 4,
      title: '草稿公告',
      content: '未发布',
      isPublished: false,
    });

    const runtimeItems = await context.service.listRuntimeAnnouncements();

    expect(runtimeItems).toHaveLength(1);
    expect(runtimeItems[0].title).toBe('当前公告');
  });

  it('should republish revoked announcements and reject invalid time ranges', async () => {
    seedAnnouncement(context, {
      id: 1,
      title: '已撤回公告',
      content: '旧内容',
      isPublished: false,
      revokedAt: new Date('2026-05-29T07:00:00.000Z'),
      publishedAt: new Date('2026-05-28T07:00:00.000Z'),
      publisherAccountId: 2,
    });

    const updated = await context.service.saveAnnouncement(
      {
        title: '重新发布公告',
        content: '新内容',
        isPublished: true,
        publisherAccountId: 9,
      },
      1,
    );

    expect(updated.isPublished).toBe(true);
    expect(updated.revokedAt).toBeUndefined();
    expect(updated.publisherAccountId).toBe(9);

    await expect(
      context.service.saveAnnouncement({
        title: '错误时间',
        content: '无效窗口',
        effectiveFrom: '2026-05-30T00:00:00.000Z',
        effectiveTo: '2026-05-29T00:00:00.000Z',
      }),
    ).rejects.toThrow('Announcement effectiveFrom must be before effectiveTo');
  });

  it('should dedupe direct receivers and support broadcast send', async () => {
    context.stores.accounts.set(
      1,
      createAccountItem({ id: 1, accountName: 'root', displayName: 'Root' }),
    );
    context.stores.accounts.set(
      2,
      createAccountItem({ id: 2, accountName: 'ops', displayName: 'Ops' }),
    );
    context.stores.accounts.set(
      3,
      createAccountItem({
        id: 3,
        accountName: 'disabled',
        displayName: 'Disabled',
        isEnabled: false,
      }),
    );

    const directItems = await context.service.sendMessages({
      title: '定向通知',
      content: '仅指定账号接收',
      receiverAccountIds: [1, 1, 2],
      senderAccountId: 8,
    });
    const broadcastItems = await context.service.sendMessages({
      title: '广播通知',
      content: '全部启用账号接收',
      isBroadcast: true,
    });

    expect(directItems.map((item) => item.receiverAccountId)).toEqual([1, 2]);
    expect(directItems.every((item) => item.senderAccountId === 8)).toBe(true);
    expect(broadcastItems.map((item) => item.receiverAccountId)).toEqual([1, 2]);
  });

  it('should support mark read, mark all read and unread count', async () => {
    seedMessage(context, {
      id: 1,
      title: '待读一',
      content: '第一条',
      receiverAccountId: 10,
      isRead: false,
    });
    seedMessage(context, {
      id: 2,
      title: '待读二',
      content: '第二条',
      receiverAccountId: 10,
      isRead: false,
    });
    seedMessage(context, {
      id: 3,
      title: '已读',
      content: '第三条',
      receiverAccountId: 10,
      isRead: true,
      readAt: new Date('2026-05-29T07:30:00.000Z'),
    });

    const firstRead = await context.service.markRead(1, 10);
    const secondRead = await context.service.markRead(1, 10);
    const batchResult = await context.service.markAllRead(10);
    const unreadCount = await context.service.unreadCount(10);

    expect(firstRead.isRead).toBe(true);
    expect(secondRead.readAt).toBe(firstRead.readAt);
    expect(batchResult.updatedCount).toBe(1);
    expect(unreadCount).toBe(0);
  });

  it('should reject station message read updates for other receivers', async () => {
    seedMessage(context, {
      id: 1,
      title: '他人消息',
      content: '不可标记',
      receiverAccountId: 10,
      isRead: false,
    });

    await expect(context.service.markRead(1, 20)).rejects.toThrow('Station message not found: 1');
    expect(context.stores.messages.get(1)?.isRead).toBe(false);
  });
});
