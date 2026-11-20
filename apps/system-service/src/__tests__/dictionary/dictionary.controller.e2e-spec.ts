import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '@/modules/account/auth/permission.guard';
import { SessionAuthGuard } from '@/modules/account/auth/session-auth.guard';
import { DictionaryController } from '@/modules/dictionary/controller/dictionary.controller';
import { DictionaryService } from '@/modules/dictionary/service/dictionary.service';

describe('DictionaryController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [DictionaryController],
      providers: [
        {
          provide: DictionaryService,
          useValue: {
            listNamespaces: vi.fn(() => [
              {
                namespace: 'system',
                count: 2,
                updatedAt: '2026-03-21T00:00:00.000Z',
              },
            ]),
            listAggregates: vi.fn(() => [
              {
                id: 1,
                namespace: 'system',
                aggregateKey: 'theme',
                label: '主题',
                count: 1,
                createdAt: '2026-03-21T00:00:00.000Z',
                updatedAt: '2026-03-21T00:00:00.000Z',
              },
            ]),
            listItems: vi.fn(() => [
              {
                id: 1,
                namespace: 'system',
                aggregateKey: 'theme',
                key: 'default',
                value: 'aurora',
                label: '默认主题',
                createdAt: '2026-03-21T00:00:00.000Z',
                updatedAt: '2026-03-21T00:00:00.000Z',
              },
            ]),
            getItem: vi.fn(() => ({
              id: 1,
              namespace: 'system',
              aggregateKey: 'theme',
              key: 'default',
              value: 'aurora',
              label: '默认主题',
              createdAt: '2026-03-21T00:00:00.000Z',
              updatedAt: '2026-03-21T00:00:00.000Z',
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

  it('/system/dictionaries/namespaces (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/dictionaries/namespaces')
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            namespace: 'system',
            count: 2,
            updatedAt: '2026-03-21T00:00:00.000Z',
          },
        ],
      });
  });

  it('/system/dictionaries/aggregates?namespace=system (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/dictionaries/aggregates')
      .query({ namespace: 'system' })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 1,
            namespace: 'system',
            aggregateKey: 'theme',
            label: '主题',
            count: 1,
            createdAt: '2026-03-21T00:00:00.000Z',
            updatedAt: '2026-03-21T00:00:00.000Z',
          },
        ],
      });
  });

  it('/system/dictionaries/items?namespace=system&aggregateKey=theme&keys=default (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/dictionaries/items')
      .query({ namespace: 'system', aggregateKey: 'theme', keys: ['default'] })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: [
          {
            id: 1,
            namespace: 'system',
            aggregateKey: 'theme',
            key: 'default',
            value: 'aurora',
            label: '默认主题',
            createdAt: '2026-03-21T00:00:00.000Z',
            updatedAt: '2026-03-21T00:00:00.000Z',
          },
        ],
      });
  });

  it('/system/dictionaries/item?namespace=system&aggregateKey=theme&key=default (GET)', () => {
    return request(app.getHttpServer())
      .get('/system/dictionaries/item')
      .query({ namespace: 'system', aggregateKey: 'theme', key: 'default' })
      .expect(200)
      .expect({
        code: 200,
        message: 'ok',
        data: {
          id: 1,
          namespace: 'system',
          aggregateKey: 'theme',
          key: 'default',
          value: 'aurora',
          label: '默认主题',
          createdAt: '2026-03-21T00:00:00.000Z',
          updatedAt: '2026-03-21T00:00:00.000Z',
        },
      });
  });
});
