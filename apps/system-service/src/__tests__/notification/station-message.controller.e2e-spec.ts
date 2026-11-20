import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { StationMessageController } from '@/modules/notification/controller/station-message.controller';
import { NotificationService } from '@/modules/notification/service/notification.service';

describe('StationMessageController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [StationMessageController],
      providers: [
        {
          provide: NotificationService,
          useValue: {
            listMessages: vi.fn(() => [
              {
                id: 1,
                title: '系统提醒',
                content: '请查看今日公告',
                receiverAccountId: 1,
                senderAccountId: 2,
                isRead: false,
                createdAt: '2026-05-29T00:00:00.000Z',
                updatedAt: '2026-05-29T00:00:00.000Z',
              },
            ]),
            listRuntimeMessages: vi.fn(() => [
              {
                id: 1,
                title: '系统提醒',
                content: '请查看今日公告',
                receiverAccountId: 1,
                senderAccountId: 2,
                isRead: false,
                createdAt: '2026-05-29T00:00:00.000Z',
                updatedAt: '2026-05-29T00:00:00.000Z',
              },
            ]),
            unreadCount: vi.fn(() => 3),
            sendMessages: vi.fn(() => [
              {
                id: 2,
                title: '批量通知',
                content: '请处理待办',
                receiverAccountId: 1,
                senderAccountId: 2,
                isRead: false,
                createdAt: '2026-05-29T00:00:00.000Z',
                updatedAt: '2026-05-29T00:00:00.000Z',
              },
            ]),
            markRead: vi.fn(() => ({
              id: 1,
              title: '系统提醒',
              content: '请查看今日公告',
              receiverAccountId: 1,
              senderAccountId: 2,
              isRead: true,
              readAt: '2026-05-29T01:00:00.000Z',
              createdAt: '2026-05-29T00:00:00.000Z',
              updatedAt: '2026-05-29T01:00:00.000Z',
            })),
            markAllRead: vi.fn(() => ({
              updatedCount: 2,
              items: [],
            })),
          },
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use((req, _res, next) => {
      req.currentAccount = {
        id: 1,
        accountName: 'admin',
        displayName: '系统管理员',
      };
      req.session = {
        account: {
          accountId: 1,
          accountName: 'admin',
          displayName: '系统管理员',
          statusVersion: 3,
          loginAt: '2026-05-29T08:00:00.000Z',
        },
      };
      next();
    });
    await app.init();
  });

  it('/system/station-messages (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/station-messages')
      .query({ receiverAccountId: 1 })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 1,
            title: '系统提醒',
            content: '请查看今日公告',
            receiverAccountId: 1,
            senderAccountId: 2,
            isRead: false,
            createdAt: '2026-05-29T00:00:00.000Z',
            updatedAt: '2026-05-29T00:00:00.000Z',
          },
        ],
      });
  });

  it('/system/station-messages/runtime/current (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/station-messages/runtime/current')
      .query({ receiverAccountId: 1 })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 1,
            title: '系统提醒',
            content: '请查看今日公告',
            receiverAccountId: 1,
            senderAccountId: 2,
            isRead: false,
            createdAt: '2026-05-29T00:00:00.000Z',
            updatedAt: '2026-05-29T00:00:00.000Z',
          },
        ],
      });
  });

  it('/system/station-messages/unread-count (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/station-messages/unread-count')
      .query({ receiverAccountId: 1 })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: 3,
      });
  });

  it('/system/station-messages/send (POST)', () => {
    return request(app.getHttpServer())
      .post('/system/station-messages/send')
      .send({
        title: '批量通知',
        content: '请处理待办',
        receiverAccountIds: [1],
      })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 2,
            title: '批量通知',
            content: '请处理待办',
            receiverAccountId: 1,
            senderAccountId: 2,
            isRead: false,
            createdAt: '2026-05-29T00:00:00.000Z',
            updatedAt: '2026-05-29T00:00:00.000Z',
          },
        ],
      });
  });

  it('/system/station-messages/read-all (PUT)', () => {
    return request(app.getHttpServer())
      .put('/system/station-messages/read-all')
      .query({ receiverAccountId: 1 })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          updatedCount: 2,
          items: [],
        },
      });
  });
});
