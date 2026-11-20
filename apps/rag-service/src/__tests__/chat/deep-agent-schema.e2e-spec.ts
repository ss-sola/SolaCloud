import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.NEST_CLOUD_TEST_POSTGRES_URL;

describe.skipIf(!databaseUrl)('DeepAgents 新库初始化', () => {
  it('从完整初始化 SQL 建立可写入的命名空间和工作区', async () => {
    const sql = await readFile(resolve(__dirname, '../../../../../sql/init.sql'), 'utf8');
    const dataSource = new DataSource({ type: 'postgres', url: databaseUrl });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    try {
      await runner.startTransaction();
      const schema = `deep_agent_init_${randomBytes(8).toString('hex')}`;
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET LOCAL search_path TO "${schema}", public`);
      await runner.query(sql);

      const namespace = await runner.query(
        'INSERT INTO deep_agent_namespace (namespace_code) VALUES ($1) RETURNING id',
        ['default'],
        true,
      );
      const workspace = await runner.query(
        'INSERT INTO deep_agent_workspace (workspace_id, namespace_id, account_id) VALUES ($1, $2, $3) RETURNING status',
        ['local-workspace', namespace.records[0].id, 1],
        true,
      );
      expect(workspace.records[0].status).toBe('running');
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await dataSource.destroy();
    }
  });
});
