import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { AnnouncementController } from '@/modules/notification/controller/announcement.controller';
import { NotificationService } from '@/modules/notification/service/notification.service';

describe('AnnouncementController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AnnouncementController],
      providers: [
        {
          provide: NotificationService,
          useValue: {
            getOverview: vi.fn(() => ({
              service: 'system-service',
              announcementCount: 2,
              messageCount: 3,
              capabilities: ['announcement-publish', 'message-send'],
            })),
            listAnnouncements: vi.fn(() => [
              {
                id: 1,
                title: '首页公告',
                content: '欢迎使用',
                isPublished: true,
                effectiveFrom: '2026-05-29T00:00:00.000Z',
                effectiveTo: '2026-05-30T00:00:00.000Z',
                publishedAt: '2026-05-29T00:00:00.000Z',
                createdAt: '2026-05-29T00:00:00.000Z',
                updatedAt: '2026-05-29T00:00:00.000Z',
              },
            ]),
            getAnnouncement: vi.fn(() => ({
              id: 1,
              title: '首页公告',
              content: '欢迎使用',
              isPublished: true,
              createdAt: '2026-05-29T00:00:00.000Z',
              updatedAt: '2026-05-29T00:00:00.000Z',
            })),
            listRuntimeAnnouncements: vi.fn(() => [
              {
                id: 1,
                title: '首页公告',
                content: '欢迎使用',
                isPublished: true,
                createdAt: '2026-05-29T00:00:00.000Z',
                updatedAt: '2026-05-29T00:00:00.000Z',
              },
            ]),
            saveAnnouncement: vi.fn(() => ({
              id: 1,
              title: '首页公告',
              content: '欢迎使用',
              isPublished: true,
              createdAt: '2026-05-29T00:00:00.000Z',
              updatedAt: '2026-05-29T00:00:00.000Z',
            })),
            removeAnnouncement: vi.fn(() => ({ success: true })),
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
    await app.init();
  });

  it('/system/announcements/overview (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/announcements/overview')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          service: 'system-service',
          announcementCount: 2,
          messageCount: 3,
          capabilities: ['announcement-publish', 'message-send'],
        },
      });
  });

  it('/system/announcements/runtime (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/announcements/runtime')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 1,
            title: '首页公告',
            content: '欢迎使用',
            isPublished: true,
            createdAt: '2026-05-29T00:00:00.000Z',
            updatedAt: '2026-05-29T00:00:00.000Z',
          },
        ],
      });
  });

  it('/system/announcements (POST)', () => {
    return request(app.getHttpServer())
      .post('/system/announcements')
      .send({
        title: '首页公告',
        content: '欢迎使用',
        isPublished: true,
      })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          id: 1,
          title: '首页公告',
          content: '欢迎使用',
          isPublished: true,
          createdAt: '2026-05-29T00:00:00.000Z',
          updatedAt: '2026-05-29T00:00:00.000Z',
        },
      });
  });
});
