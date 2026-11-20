import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import {
  CommonConfig,
  ConfigKeys,
  ContextService,
  DatabaseIdempotencyService,
  validateConfig,
} from '@nest-cloud/sdk';
import { Controller, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RagServiceClient } from '../client/rag-service.client';
import { FileController } from '../modules/file/controller/file.controller';
import { FileItem } from '../modules/file/entity/file-item.entity';
import { FILE_CONTROLLER_ROUTE } from '../modules/file/file.constants';
import { FileService } from '../modules/file/service/file.service';
import { FileStorageService } from '../modules/file/service/file-storage.service';
import type { FileUploadSessionService } from '../modules/file/service/file-upload-session.service';
import type { FileZipExtractService } from '../modules/file/service/file-zip-extract.service';

interface Attempt {
  receiver: number;
  incomingTrace?: string;
  serverTrace?: { traceId: string; spanId: string };
  key?: string | string[];
}

interface Caller {
  updateFileDescription(input: { id: number; description: string }): Promise<{ data: boolean }>;
  getFileDetailBatch(input: {
    ids: number[];
  }): Promise<{ data: { id: number; description: string }[] }>;
}

// 与公共包 PostgreSQL 专项共用显式的测试连接参数。仅在本次创建的随机 schema 内写入和清理。
const url = process.env.NEST_CLOUD_TEST_POSTGRES_URL;
describe.skipIf(!url)('文件接口跨实例 HTTP 重试', () => {
  const schema = 'file_retry_' + randomUUID().replaceAll('-', '');
  const admin = new DataSource({ type: 'postgres', url });
  const pools = [0, 1].map(
    () =>
      new DataSource({
        type: 'postgres',
        url,
        schema,
        entities: [FileItem],
        extra: { options: `-c search_path=${schema}` },
      }),
  );
  const apps: INestApplication[] = [];
  const attempts = { write: [] as Attempt[], read: [] as Attempt[] };
  let client: Caller;
  let fileId: number;
  let committedResponse: unknown;

  async function startReceiver(pool: DataSource, index: number) {
    const files = new FileService(
      pool.getRepository(FileItem),
      new FileStorageService(),
      {} as RagServiceClient,
    );
    const idempotency = new DatabaseIdempotencyService(pool);
    // 复用生产 Controller 的继承路由；未涉及的上传和解压服务不参与故障注入。
    @Controller(FILE_CONTROLLER_ROUTE)
    class Receiver extends FileController {
      constructor() {
        super(files, {} as FileUploadSessionService, {} as FileZipExtractService, idempotency);
      }
    }
    const module = await Test.createTestingModule({ controllers: [Receiver] }).compile();
    const app = module.createNestApplication({ logger: false });
    apps.push(app);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.use((req: Request, res: Response, next: NextFunction) =>
      ContextService.setStore({ req, res }, () => {
        const write = req.method === 'PUT';
        const calls = write ? attempts.write : attempts.read;
        calls.push({
          receiver: index,
          incomingTrace: req.get('traceparent'),
          serverTrace: ContextService.getTrace(),
          key: req.headers['idempotency-key'],
        });
        if (calls.length === 1) {
          if (!write) return res.sendStatus(503);
          // Nest 只有在 Controller 的事务提交之后才发送 JSON；在 end 处丢弃数据并关闭 TCP。
          res.end = (body?: unknown) => {
            committedResponse = JSON.parse(String(body));
            res.destroy();
            return res;
          };
        }
        next();
      }),
    );
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    return { name: 'middleware-service', host: '127.0.0.1', port, id: String(port) };
  }

  beforeAll(async () => {
    const schemaFile =
      process.env.NEST_CLOUD_TEST_RPC_SCHEMA_FILE ||
      resolve(__dirname, '../../../../../NestCloud/sql/sdk/add-rpc-idempotency-record.sql');
    const idempotencySql = await readFile(schemaFile, 'utf8');
    await admin.initialize();
    await admin.query(`CREATE SCHEMA ${schema}`);
    for (const pool of pools) await pool.initialize();
    await pools[0].synchronize();
    await pools[0].query(idempotencySql);
    await pools[0].query(`CREATE TABLE observed_file_write (file_id integer NOT NULL);
      CREATE FUNCTION observe_file_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO observed_file_write VALUES (NEW.id); RETURN NEW; END;
      $$;
      CREATE TRIGGER count_business_updates AFTER UPDATE ON middleware_file_item
        FOR EACH ROW EXECUTE FUNCTION observe_file_write();`);
    const file = await pools[0].getRepository(FileItem).save({
      originalName: 'test.txt',
      storageKey: 'retry',
      storagePath: 'fixture/test.txt',
      mimeType: 'text/plain',
      size: 1,
    });
    fileId = file.id;
    validateConfig(CommonConfig, {
      [ConfigKeys.ServiceName]: 'rag-service',
      [ConfigKeys.Port]: 3100,
      [ConfigKeys.NodeEnv]: 'production',
      [ConfigKeys.RemoteWriteRetryEnabled]: true,
    });
    const instances: Awaited<ReturnType<typeof startReceiver>>[] = [];
    for (const [index, pool] of pools.entries()) instances.push(await startReceiver(pool, index));
    // 只替换注册目录；调用走 RAG 正式客户端的装饰器、负载均衡和真正的 Axios HTTP 请求。
    const ragClientSource = resolve(
      __dirname,
      '../../../rag-service/src/client/file-service.client.ts',
    );
    const { FileServiceClient } = await import(/* @vite-ignore */ ragClientSource);
    client = Object.assign(new FileServiceClient(), {
      registryClient: { getInstances: () => instances },
    });
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    for (const pool of pools) if (pool.isInitialized) await pool.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.destroy();
    }
  });

  function verifyTrace(calls: Attempt[]) {
    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    expect(second.receiver).not.toBe(first.receiver);
    const [firstTrace, secondTrace] = calls.map((call) => call.incomingTrace?.split('-'));
    expect(firstTrace?.[1]).toMatch(/^[a-f0-9]{32}$/);
    expect(secondTrace?.[1]).toBe(firstTrace?.[1]);
    expect(secondTrace?.[2]).not.toBe(firstTrace?.[2]);
    expect(first.serverTrace?.traceId).toBe(firstTrace?.[1]);
    expect(second.serverTrace?.traceId).toBe(firstTrace?.[1]);
    expect(second.serverTrace?.spanId).not.toBe(first.serverTrace?.spanId);
  }

  it('数据库提交后连接断开，另一实例回放首次响应，实际 UPDATE 仅一次', async () => {
    const response = await client.updateFileDescription({ id: fileId, description: '已处理' });
    expect(response).toEqual({ code: 200, message: 'ok', data: true });
    expect(response).toEqual(committedResponse);
    verifyTrace(attempts.write);
    expect(attempts.write[0].key).toBeTruthy();
    expect(attempts.write[1].key).toBe(attempts.write[0].key);
    expect(await pools[1].query('SELECT file_id FROM observed_file_write')).toEqual([
      { file_id: fileId },
    ]);
    expect(
      (await pools[1].getRepository(FileItem).findOneByOrFail({ id: fileId })).description,
    ).toBe('已处理');
  });

  it('批量查询遇到 503 后重选实例，不发送幂等键', async () => {
    const response = await client.getFileDetailBatch({ ids: [fileId] });
    expect(response.data.map((file) => file.id)).toEqual([fileId]);
    verifyTrace(attempts.read);
    expect(attempts.read.every((call) => call.key === undefined)).toBe(true);
  });
});
