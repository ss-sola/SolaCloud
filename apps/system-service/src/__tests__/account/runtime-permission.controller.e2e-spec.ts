import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { RuntimePermissionController } from '@/modules/account/controller/runtime-permission.controller';
import { RuntimePermissionService } from '@/modules/account/service/runtime-permission.service';

describe('RuntimePermissionController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const runtimePermissionService = {
      getRuntimeByAccountId: vi.fn(() => ({
        account: {
          id: 7,
          accountName: 'auditor',
          displayName: '审计员',
        },
        roleCodes: ['auditor'],
        permissionCodes: ['system:login-log:query'],
        menuTree: [],
      })),
      checkPermissions: vi.fn(() => ({
        allowed: false,
        missingPermissionCodes: ['system:account:manage'],
      })),
      invalidateAccount: vi.fn(),
      invalidateAll: vi.fn(),
    } as unknown as RuntimePermissionService;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [RuntimePermissionController],
      providers: [
        {
          provide: RuntimePermissionService,
          useValue: runtimePermissionService,
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
        id: 7,
        accountName: 'auditor',
        displayName: '审计员',
      };
      req.session = {
        account: {
          accountId: 7,
          accountName: 'auditor',
          displayName: '审计员',
          statusVersion: 1,
          loginAt: '2026-05-29T08:00:00.000Z',
        },
      };
      next();
    });
    await app.init();
  });

  it('/system/runtime-permissions/current?accountId=7 (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/runtime-permissions/current')
      .query({ accountId: 7 })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          account: {
            id: 7,
            accountName: 'auditor',
            displayName: '审计员',
          },
          roleCodes: ['auditor'],
          menuTree: [],
        },
      });
  });

  it('/system/runtime-permissions/check (POST)', () => {
    return request(app.getHttpServer())
      .post('/system/runtime-permissions/check')
      .send({ accountId: 7, permissionCodes: ['system:account:manage'] })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          allowed: false,
          missingPermissionCodes: ['system:account:manage'],
        },
      });
  });

  it('/system/runtime-permissions/refresh?accountId=7 (POST)', () => {
    return request(app.getHttpServer())
      .post('/system/runtime-permissions/refresh')
      .query({ accountId: 7 })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          success: true,
        },
      });
  });
});
