import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthController } from '@/modules/account/controller/auth.controller';
import { AccountService } from '@/modules/account/service/account.service';
import { OnlineUserService } from '@/modules/monitor/service/online-user.service';

describe('AuthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AccountService,
          useValue: {
            login: vi.fn(() => ({
              accountId: 1,
              accountName: 'admin',
              displayName: '系统管理员',
              statusVersion: 3,
              loginAt: '2026-05-29T08:00:00.000Z',
            })),
            logout: vi.fn(() => Promise.resolve()),
            refreshSession: vi.fn(() => ({
              accountId: 1,
              accountName: 'admin',
              displayName: '系统管理员',
              statusVersion: 3,
              loginAt: '2026-05-29T08:00:00.000Z',
            })),
            validateSession: vi.fn(() => ({
              id: 1,
              accountName: 'admin',
              displayName: '系统管理员',
            })),
          },
        },
        {
          provide: OnlineUserService,
          useValue: {
            upsert: vi.fn(),
            removeBySessionId: vi.fn(),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use((req, _res, next) => {
      req.sessionID = 'session-1';
      req.session = {
        account: {
          accountId: 1,
          accountName: 'admin',
          displayName: '系统管理员',
          statusVersion: 3,
          loginAt: '2026-05-29T08:00:00.000Z',
        },
        destroy: (callback: (error?: unknown) => void) => callback(),
      };
      next();
    });
    await app.init();
  });

  it('/system/auth/login (POST)', () => {
    return request(app.getHttpServer())
      .post('/system/auth/login')
      .send({ accountName: 'admin', password: 'admin123' })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          accountId: 1,
          accountName: 'admin',
          displayName: '系统管理员',
          statusVersion: 3,
          loginAt: '2026-05-29T08:00:00.000Z',
        },
      });
  });

  it('/system/auth/refresh (POST)', () => {
    return request(app.getHttpServer())
      .post('/system/auth/refresh')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          accountId: 1,
          accountName: 'admin',
          displayName: '系统管理员',
          statusVersion: 3,
          loginAt: '2026-05-29T08:00:00.000Z',
        },
      });
  });

  it('/system/auth/current (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/auth/current')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          accountId: 1,
          accountName: 'admin',
          displayName: '系统管理员',
        },
      });
  });

  it('/system/auth/logout (POST)', () => {
    return request(app.getHttpServer())
      .post('/system/auth/logout')
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
