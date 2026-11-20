import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { PermissionController } from '@/modules/permission/controller/permission.controller';
import { PermissionService } from '@/modules/permission/service/permission.service';

describe('PermissionController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PermissionController],
      providers: [
        {
          provide: PermissionService,
          useValue: {
            getOverview: vi.fn(() => ({
              service: 'system-service',
              itemCount: 2,
              capabilities: ['item-crud', 'group-query', 'enable-disable'],
            })),
            listItems: vi.fn(() => [
              {
                id: 1,
                code: 'system:dictionary:manage',
                name: '字典管理',
                groupKey: 'resource',
                description: '维护系统字典',
                isEnabled: true,
                createdAt: '2026-05-28T00:00:00.000Z',
                updatedAt: '2026-05-28T00:00:00.000Z',
              },
            ]),
            getItem: vi.fn(() => ({
              id: 1,
              code: 'system:dictionary:manage',
              name: '字典管理',
              groupKey: 'resource',
              description: '维护系统字典',
              isEnabled: true,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
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
    await app.init();
  });

  it('/system/permissions/overview (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/permissions/overview')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          service: 'system-service',
          itemCount: 2,
          capabilities: ['item-crud', 'group-query', 'enable-disable'],
        },
      });
  });

  it('/system/permissions (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/permissions')
      .query({ groupKey: 'resource', isEnabled: true })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 1,
            code: 'system:dictionary:manage',
            name: '字典管理',
            groupKey: 'resource',
            description: '维护系统字典',
            isEnabled: true,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          },
        ],
      });
  });
});
