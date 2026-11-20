import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { AccountController } from '@/modules/account/controller/account.controller';
import { AccountService } from '@/modules/account/service/account.service';

describe('AccountController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        {
          provide: AccountService,
          useValue: {
            getOverview: vi.fn(() => ({
              service: 'system-service',
              itemCount: 2,
              capabilities: [
                'item-crud',
                'login-session',
                'role-binding',
                'password-reset',
                'avatar-upload',
              ],
              avatarUpload: {
                uploadUrl: 'http://localhost:3300/api/file/upload',
                scene: 'account',
                businessType: 'account-avatar',
                isTemporary: false,
              },
            })),
            listItems: vi.fn(() => [
              {
                id: 1,
                accountName: 'admin',
                displayName: '系统管理员',
                isEnabled: true,
                failedLoginCount: 0,
                roleCodes: ['system-admin'],
                createdAt: '2026-05-29T00:00:00.000Z',
                updatedAt: '2026-05-29T00:00:00.000Z',
              },
            ]),
            listOptions: vi.fn(() => [
              {
                id: 1,
                accountName: 'admin',
                displayName: '系统管理员',
              },
            ]),
            getItem: vi.fn(() => ({
              id: 1,
              accountName: 'admin',
              displayName: '系统管理员',
              isEnabled: true,
              failedLoginCount: 0,
              roleCodes: ['system-admin'],
              createdAt: '2026-05-29T00:00:00.000Z',
              updatedAt: '2026-05-29T00:00:00.000Z',
            })),
            saveRoleCodes: vi.fn(() => ({
              id: 1,
              accountName: 'admin',
              displayName: '系统管理员',
              isEnabled: true,
              failedLoginCount: 0,
              roleCodes: ['system-admin', 'auditor'],
              createdAt: '2026-05-29T00:00:00.000Z',
              updatedAt: '2026-05-29T00:00:00.000Z',
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

  it('/system/accounts/overview (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/accounts/overview')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          service: 'system-service',
          itemCount: 2,
          capabilities: [
            'item-crud',
            'login-session',
            'role-binding',
            'password-reset',
            'avatar-upload',
          ],
          avatarUpload: {
            uploadUrl: 'http://localhost:3300/api/file/upload',
            scene: 'account',
            businessType: 'account-avatar',
            isTemporary: false,
          },
        },
      });
  });

  it('/system/accounts (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/accounts')
      .query({ keyword: 'admin' })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 1,
            accountName: 'admin',
            displayName: '系统管理员',
            isEnabled: true,
            failedLoginCount: 0,
            roleCodes: ['system-admin'],
            createdAt: '2026-05-29T00:00:00.000Z',
            updatedAt: '2026-05-29T00:00:00.000Z',
          },
        ],
      });
  });

  it('/system/accounts/options (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/accounts/options')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 1,
            accountName: 'admin',
            displayName: '系统管理员',
          },
        ],
      });
  });

  it('/system/accounts/roles?id=1 (PUT)', () => {
    return request(app.getHttpServer())
      .put('/system/accounts/roles')
      .query({ id: 1 })
      .send({ roleCodes: ['system-admin', 'auditor'] })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          id: 1,
          accountName: 'admin',
          displayName: '系统管理员',
          isEnabled: true,
          failedLoginCount: 0,
          roleCodes: ['system-admin', 'auditor'],
          createdAt: '2026-05-29T00:00:00.000Z',
          updatedAt: '2026-05-29T00:00:00.000Z',
        },
      });
  });
});
