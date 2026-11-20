import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { RoleController } from '@/modules/role/controller/role.controller';
import { RoleService } from '@/modules/role/service/role.service';

describe('RoleController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [RoleController],
      providers: [
        {
          provide: RoleService,
          useValue: {
            getOverview: vi.fn(() => ({
              service: 'system-service',
              itemCount: 1,
              capabilities: ['item-crud', 'permission-binding', 'runtime-preview'],
            })),
            listItems: vi.fn(() => [
              {
                id: 1,
                code: 'system-admin',
                name: '系统管理员',
                description: '默认系统管理员角色',
                isEnabled: true,
                permissionCodes: ['system:dictionary:manage', 'system:menu-route:manage'],
                createdAt: '2026-05-28T00:00:00.000Z',
                updatedAt: '2026-05-28T00:00:00.000Z',
              },
            ]),
            getItem: vi.fn(() => ({
              id: 1,
              code: 'system-admin',
              name: '系统管理员',
              description: '默认系统管理员角色',
              isEnabled: true,
              permissionCodes: ['system:dictionary:manage', 'system:menu-route:manage'],
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
            })),
            getRuntimeByRoleCode: vi.fn(() => ({
              roleCode: 'system-admin',
              menuTree: [
                {
                  id: 2,
                  code: 'dictionary-management',
                  name: '字典管理',
                  path: 'dictionary',
                  sort: 1,
                  isEnabled: true,
                  isHidden: false,
                  createdAt: '2026-05-28T00:00:00.000Z',
                  updatedAt: '2026-05-28T00:00:00.000Z',
                  children: [],
                },
              ],
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

  it('/system/roles (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/roles')
      .query({ isEnabled: true })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 1,
            code: 'system-admin',
            name: '系统管理员',
            description: '默认系统管理员角色',
            isEnabled: true,
            permissionCodes: ['system:dictionary:manage', 'system:menu-route:manage'],
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          },
        ],
      });
  });

  it('/system/roles/runtime?roleCode=system-admin (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/roles/runtime')
      .query({ roleCode: 'system-admin' })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          roleCode: 'system-admin',
          menuTree: [
            {
              id: 2,
              code: 'dictionary-management',
              name: '字典管理',
              path: 'dictionary',
              sort: 1,
              isEnabled: true,
              isHidden: false,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              children: [],
            },
          ],
        },
      });
  });
});
