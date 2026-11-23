import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { PermissionController } from '@/modules/permission/controller/permission.controller';
import { PermissionService } from '@/modules/permission/service/permission.service';

describe('PermissionController (e2e)', () => {
  let app: INestApplication<App>;
  const filteredPage = { list: [], page: 1, pageNum: 1, pageSize: 10, total: 0, totalPages: 1 };
  const queryItems = vi.fn(() => filteredPage);
  const listItems = vi.fn(() => filteredPage);

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
            queryItems,
            listItems,
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
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
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

  it.each([
    ['/system/permissions', queryItems],
    ['/system/permissions/list', listItems],
  ])('%s applies keyword, group and false status', async (path, handler) => {
    await request(app.getHttpServer())
      .get(path)
      .query({ keyword: '字典', groupKey: 'resource', isEnabled: false })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: filteredPage,
      });
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        keyword: '字典',
        groupKey: 'resource',
        isEnabled: false,
        pageSize: path.endsWith('/list') ? 10 : 200,
      }),
    );
  });
});
