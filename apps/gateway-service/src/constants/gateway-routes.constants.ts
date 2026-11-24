import { UPSTREAM, type UpstreamName } from './gateway.constants';

export type GatewayRoute = { upstream: UpstreamName; streaming?: true };
type RouteGroup = Readonly<Record<string, readonly string[]>>;

// Each entry is a browser-facing operation. Transport methods use the same URL upstream.
export const SYSTEM_ROUTES: RouteGroup = {
  GET: [
    'auth/current',
    'runtime-permissions/current',
    'accounts',
    'accounts/list',
    'accounts/overview',
    'accounts/options',
    'accounts/item',
    'accounts/roles',
    'roles',
    'roles/list',
    'roles/overview',
    'roles/options',
    'roles/item',
    'roles/runtime',
    'permissions',
    'permissions/list',
    'permissions/overview',
    'permissions/item',
    'menu-routes/overview',
    'menu-routes/list',
    'menu-routes/tree',
    'menu-routes/item',
    'dictionaries/overview',
    'dictionaries/namespaces',
    'dictionaries/namespace',
    'dictionaries/aggregates',
    'dictionaries/aggregate',
    'dictionaries/items',
    'dictionaries/item',
    'dictionaries/runtime',
    'announcements',
    'announcements/list',
    'announcements/overview',
    'announcements/item',
    'announcements/runtime',
    'station-messages',
    'station-messages/list',
    'station-messages/runtime/current',
    'station-messages/unread-count',
    'monitors/overview',
    'monitors/service',
    'monitors/online-users',
    'login-logs',
    'login-logs/list',
    'login-logs/overview',
    'operation-logs',
    'operation-logs/list',
    'operation-logs/overview',
    'trace-logs',
    'trace-logs/detail',
  ],
  POST: [
    'auth/login',
    'auth/logout',
    'auth/refresh',
    'auth/refresh-permissions',
    'accounts',
    'accounts/item',
    'roles',
    'roles/item',
    'permissions',
    'permissions/item',
    'menu-routes',
    'menu-routes/item',
    'dictionaries/import',
    'announcements',
    'announcements/item',
    'station-messages/send',
  ],
  PUT: [
    'accounts/item',
    'accounts/password',
    'accounts/roles',
    'roles/item',
    'permissions/item',
    'menu-routes/item',
    'menu-routes/batch-status',
    'menu-routes/reorder',
    'dictionaries/namespace',
    'dictionaries/aggregate',
    'dictionaries/item',
    'announcements/item',
    'station-messages/read',
    'station-messages/read-all',
  ],
  DELETE: [
    'accounts/item',
    'roles/item',
    'permissions/item',
    'menu-routes/item',
    'dictionaries/namespace',
    'dictionaries/aggregate',
    'dictionaries/item',
    'announcements/item',
    'monitors/online-users',
  ],
};

export const FILE_ROUTES: RouteGroup = {
  GET: ['list', 'detail', 'tree'],
  POST: ['upload/check', 'upload', 'upload/merge'],
  DELETE: ['remove'],
};

export const KNOWLEDGE_ROUTES: RouteGroup = {
  GET: ['base/list'],
  POST: ['base'],
};

export const CHAT_ROUTES: RouteGroup = {
  GET: ['session/list', 'session/messages'],
  POST: ['session', 'similar-queries', 'session/summarize'],
  DELETE: ['session'],
};

const CALL_GRAPH_ROUTES: RouteGroup = { POST: ['scan', 'graph', 'start', 'stop'] };

export const GATEWAY_ROUTE_GROUPS = [
  { prefix: '/api/call-graph/', routes: CALL_GRAPH_ROUTES, upstream: UPSTREAM.callGraph },
  { prefix: '/api/system/', routes: SYSTEM_ROUTES, upstream: UPSTREAM.system },
  { prefix: '/api/file/', routes: FILE_ROUTES, upstream: UPSTREAM.file },
  { prefix: '/api/knowledge/', routes: KNOWLEDGE_ROUTES, upstream: UPSTREAM.rag },
  { prefix: '/api/chat/', routes: CHAT_ROUTES, upstream: UPSTREAM.rag },
] as const;
