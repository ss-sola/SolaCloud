import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { OperationLogController } from '@/modules/operation-log/controller/operation-log.controller';
import { OperationLogService } from '@/modules/operation-log/service/operation-log.service';

describe('OperationLogController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [OperationLogController],
      providers: [
        {
          provide: OperationLogService,
          useValue: {
            getOverview: vi.fn(() => ({
              service: 'system-service',
              itemCount: 3,
              capabilities: ['list-query', 'module-filter', 'action-filter'],
            })),
            listItems: vi.fn(() => [
              {
                id: 3,
                module: 'role',
                action: 'item-update',
                targetType: 'role',
                targetId: 'system-admin',
                summary: 'Role updated: system-admin',
                operator: 'system-service',
                createdAt: '2026-05-28T00:00:00.000Z',
                updatedAt: '2026-05-28T00:00:00.000Z',
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

  it('/system/operation-logs/overview (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/operation-logs/overview')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          service: 'system-service',
          itemCount: 3,
          capabilities: ['list-query', 'module-filter', 'action-filter'],
        },
      });
  });

  it('/system/operation-logs (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/operation-logs')
      .query({ module: 'role' })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 3,
            module: 'role',
            action: 'item-update',
            targetType: 'role',
            targetId: 'system-admin',
            summary: 'Role updated: system-admin',
            operator: 'system-service',
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          },
        ],
      });
  });
});
