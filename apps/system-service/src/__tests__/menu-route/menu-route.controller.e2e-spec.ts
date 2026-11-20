import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { MenuRouteController } from '@/modules/menu-route/controller/menu-route.controller';
import { MenuRouteService } from '@/modules/menu-route/service/menu-route.service';

describe('MenuRouteController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MenuRouteController],
      providers: [
        {
          provide: MenuRouteService,
          useValue: {
            listTree: vi.fn(() => [
              {
                id: 1,
                code: 'dictionary-management',
                name: '字典管理',
                path: 'dictionary-config',
                routeName: 'dictionary',
                sort: 1,
                isEnabled: true,
                isHidden: false,
                permissionCodes: ['system:dictionary:manage'],
                createdAt: '2026-05-26T00:00:00.000Z',
                updatedAt: '2026-05-26T00:00:00.000Z',
                children: [],
              },
            ]),
            getItem: vi.fn(() => ({
              id: 1,
              code: 'dictionary-management',
              name: '字典管理',
              path: 'dictionary-config',
              routeName: 'dictionary',
              sort: 1,
              isEnabled: true,
              isHidden: false,
              permissionCodes: ['system:dictionary:manage'],
              createdAt: '2026-05-26T00:00:00.000Z',
              updatedAt: '2026-05-26T00:00:00.000Z',
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

  it('/system/menu-routes/tree (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/menu-routes/tree')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 1,
            code: 'dictionary-management',
            name: '字典管理',
            path: 'dictionary-config',
            routeName: 'dictionary',
            sort: 1,
            isEnabled: true,
            isHidden: false,
            permissionCodes: ['system:dictionary:manage'],
            createdAt: '2026-05-26T00:00:00.000Z',
            updatedAt: '2026-05-26T00:00:00.000Z',
            children: [],
          },
        ],
      });
  });

  it('/system/menu-routes/item?id=1 (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/menu-routes/item')
      .query({ id: 1 })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          id: 1,
          code: 'dictionary-management',
          name: '字典管理',
          path: 'dictionary-config',
          routeName: 'dictionary',
          sort: 1,
          isEnabled: true,
          isHidden: false,
          permissionCodes: ['system:dictionary:manage'],
          createdAt: '2026-05-26T00:00:00.000Z',
          updatedAt: '2026-05-26T00:00:00.000Z',
        },
      });
  });
});
