#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const MENU_ITEMS = [
  {
    code: 'system-management',
    name: '系统管理',
    path: 'system-management',
    component: null,
    icon: 'system-management',
    sort: 1,
    isEnabled: true,
    isHidden: false,
    permissionCodes: [],
    meta: { group: true },
  },
  {
    code: 'system-resource-group',
    name: '基础资源',
    path: 'system-resource-group',
    parentCode: 'system-management',
    component: null,
    icon: 'system-resource-group',
    sort: 1,
    isEnabled: true,
    isHidden: false,
    permissionCodes: [],
    meta: { group: true },
  },
  {
    code: 'system-access-group',
    name: '身份权限',
    path: 'system-access-group',
    parentCode: 'system-management',
    component: null,
    icon: 'system-access-group',
    sort: 2,
    isEnabled: true,
    isHidden: false,
    permissionCodes: [],
    meta: { group: true },
  },
  {
    code: 'system-observe-group',
    name: '运行与审计',
    path: 'system-observe-group',
    parentCode: 'system-management',
    component: null,
    icon: 'system-observe-group',
    sort: 3,
    isEnabled: true,
    isHidden: false,
    permissionCodes: [],
    meta: { group: true },
  },
  {
    code: 'system-monitor-group',
    name: '系统监控',
    path: 'system-monitor-group',
    parentCode: 'system-management',
    component: null,
    icon: 'system-monitor-group',
    sort: 4,
    isEnabled: true,
    isHidden: false,
    permissionCodes: [],
    meta: { group: true },
  },
  {
    code: 'dictionary-namespace-management',
    name: '命名空间管理',
    path: 'dictionary-namespace',
    parentCode: 'system-resource-group',
    component: 'dictionary-namespace',
    icon: 'dictionary-namespace',
    sort: 1,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:dictionary:manage'],
    meta: null,
  },
  {
    code: 'dictionary-management',
    name: '字典管理',
    path: 'dictionary',
    parentCode: 'system-resource-group',
    component: 'dictionary',
    icon: 'dictionary',
    sort: 2,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:dictionary:manage'],
    meta: null,
  },
  {
    code: 'menu-route-management',
    name: '菜单管理',
    path: 'menu-route',
    parentCode: 'system-resource-group',
    component: 'menu-route',
    icon: 'menu-route',
    sort: 3,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:menu-route:manage'],
    meta: null,
  },
  {
    code: 'notification-management',
    name: '通知公告',
    path: 'notification',
    parentCode: 'system-resource-group',
    component: 'notification',
    icon: 'notification',
    sort: 5,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:notification:manage'],
    meta: null,
  },
  {
    code: 'permission-management',
    name: '权限码管理',
    path: 'permission',
    parentCode: 'system-access-group',
    component: 'permission',
    icon: 'permission',
    sort: 1,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:permission:manage'],
    meta: null,
  },
  {
    code: 'role-management',
    name: '角色管理',
    path: 'role',
    parentCode: 'system-access-group',
    component: 'role',
    icon: 'role',
    sort: 2,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:role:manage'],
    meta: null,
  },
  {
    code: 'account-management',
    name: '管理账号',
    path: 'account',
    parentCode: 'system-access-group',
    component: 'account',
    icon: 'account',
    sort: 3,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:account:manage'],
    meta: null,
  },
  {
    code: 'login-log-management',
    name: '登录日志',
    path: 'login-log',
    parentCode: 'system-observe-group',
    component: 'login-log',
    icon: 'login-log',
    sort: 1,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:login-log:query'],
    meta: null,
  },
  {
    code: 'operation-log-management',
    name: '操作日志',
    path: 'operation-log',
    parentCode: 'system-observe-group',
    component: 'operation-log',
    icon: 'operation-log',
    sort: 2,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:operation-log:query'],
    meta: null,
  },
  {
    code: 'online-user-monitor-management',
    name: '在线用户监控',
    path: 'online-user-monitor',
    parentCode: 'system-monitor-group',
    component: 'online-user-monitor',
    icon: 'online-user-monitor',
    sort: 1,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:monitor:online-user:query'],
    meta: null,
  },
  {
    code: 'service-monitor-management',
    name: '服务监控',
    path: 'service-monitor',
    parentCode: 'system-monitor-group',
    component: 'service-monitor',
    icon: 'service-monitor',
    sort: 2,
    isEnabled: true,
    isHidden: false,
    permissionCodes: ['system:monitor:service:query'],
    meta: null,
  },
];

const DEPRECATED_MENU_CODES = ['runtime-permission-management'];

async function main() {
  const env = loadEnvFile();
  const client = new Client({
    host: requiredEnv(env, 'DbHost'),
    port: Number(requiredEnv(env, 'DbPort')),
    user: requiredEnv(env, 'DbUsername'),
    password: env.DbPassword ?? '',
    database: requiredEnv(env, 'DbDatabase'),
  });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE IF EXISTS sys_menu_route DROP COLUMN IF EXISTS "routeName"');

    await softDeleteDeprecatedMenus(client);
    await upsertOfficialMenus(client);

    const summary = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total,
        COUNT(*) FILTER (
          WHERE deleted_at IS NULL
            AND COALESCE((meta->>'group')::boolean, false) = false
            AND (component IS NULL OR btrim(component) = '')
        ) AS missing_component,
        COUNT(*) FILTER (
          WHERE deleted_at IS NULL
            AND (icon IS NULL OR btrim(icon) = '')
        ) AS missing_icon
      FROM sys_menu_route
    `);

    await client.query('COMMIT');
    console.log(JSON.stringify(summary.rows[0], null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function softDeleteDeprecatedMenus(client) {
  if (DEPRECATED_MENU_CODES.length === 0) {
    return;
  }

  await client.query(
    `
      UPDATE sys_role_menu_route
      SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE deleted_at IS NULL
        AND "menuRouteId" IN (
          SELECT id
          FROM sys_menu_route
          WHERE code = ANY($1::text[])
            AND deleted_at IS NULL
        )
    `,
    [DEPRECATED_MENU_CODES],
  );

  await client.query(
    `
      UPDATE sys_menu_route
      SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE code = ANY($1::text[])
        AND deleted_at IS NULL
    `,
    [DEPRECATED_MENU_CODES],
  );
}

async function upsertOfficialMenus(client) {
  const idsByCode = new Map();

  for (const item of MENU_ITEMS) {
    const parentId = item.parentCode ? (idsByCode.get(item.parentCode) ?? null) : null;
    const params = [
      item.code,
      item.name,
      item.path,
      parentId,
      item.component,
      null,
      item.icon,
      item.sort,
      item.isEnabled,
      item.isHidden,
      JSON.stringify(item.permissionCodes),
      item.meta ? JSON.stringify(item.meta) : null,
    ];

    const existing = await client.query('SELECT id FROM sys_menu_route WHERE code = $1 LIMIT 1', [
      item.code,
    ]);

    const sql = existing.rowCount
      ? `
          UPDATE sys_menu_route
          SET name = $2,
              path = $3,
              "parentId" = $4,
              component = $5,
              redirect = $6,
              icon = $7,
              sort = $8,
              "isEnabled" = $9,
              "isHidden" = $10,
              "permissionCodes" = $11::jsonb,
              meta = $12::jsonb,
              deleted_at = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE code = $1
          RETURNING id
        `
      : `
          INSERT INTO sys_menu_route (
            code,
            name,
            path,
            "parentId",
            component,
            redirect,
            icon,
            sort,
            "isEnabled",
            "isHidden",
            "permissionCodes",
            meta
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11::jsonb,
            $12::jsonb
          )
          RETURNING id
        `;

    const result = await client.query(sql, params);
    idsByCode.set(item.code, result.rows[0].id);
  }
}

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env');
  const raw = fs.readFileSync(envPath, 'utf8');
  return parseEnv(raw);
}

function parseEnv(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function requiredEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
