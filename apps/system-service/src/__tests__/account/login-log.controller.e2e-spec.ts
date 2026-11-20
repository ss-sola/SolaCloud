import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { LoginLogController } from '@/modules/account/controller/login-log.controller';
import { LoginLogService } from '@/modules/account/service/login-log.service';

describe('LoginLogController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LoginLogController],
      providers: [
        {
          provide: LoginLogService,
          useValue: {
            getOverview: vi.fn(() => ({
              service: 'system-service',
              itemCount: 4,
              capabilities: ['security-event-query'],
            })),
            listItems: vi.fn(() => [
              {
                id: 4,
                accountId: 1,
                accountName: 'admin',
                eventType: 'logout',
                success: true,
                message: 'Logout success',
                ip: '127.0.0.1',
                userAgent: 'jest',
                createdAt: '2026-05-29T00:00:00.000Z',
                updatedAt: '2026-05-29T00:00:00.000Z',
              },
            ]),
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

  it('/system/login-logs/overview (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/login-logs/overview')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          service: 'system-service',
          itemCount: 4,
          capabilities: ['security-event-query'],
        },
      });
  });

  it('/system/login-logs (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/login-logs')
      .query({ accountName: 'admin' })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 4,
            accountId: 1,
            accountName: 'admin',
            eventType: 'logout',
            success: true,
            message: 'Logout success',
            ip: '127.0.0.1',
            userAgent: 'jest',
            createdAt: '2026-05-29T00:00:00.000Z',
            updatedAt: '2026-05-29T00:00:00.000Z',
          },
        ],
      });
  });
});
