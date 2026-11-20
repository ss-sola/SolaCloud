import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface MockHandler {
  method?: string;
  path: string;
  handle: (url: URL, init?: RequestInit) => MockResponse | Promise<MockResponse>;
}

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function createApiResponse(data: unknown, status = 200, code = 200, message = 'ok'): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ code, message, data }),
  };
}

function createApiError(message = 'unauthorized', status = 401, code = 401): MockResponse {
  return createApiResponse(null, status, code, message);
}

function installFetchMock(handlers: MockHandler[]) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const requestUrl =
      typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const requestMethod =
      init?.method ??
      (typeof input === 'string' || input instanceof URL ? 'GET' : input.method) ??
      'GET';
    const url = new URL(requestUrl, 'http://localhost');
    const method = requestMethod.toUpperCase();
    const handler = handlers.find(
      (item) => (item.method ?? 'GET').toUpperCase() === method && item.path === url.pathname,
    );

    if (!handler) {
      throw new Error(`Unhandled request: ${method} ${url.pathname}${url.search}`);
    }

    return handler.handle(url, init);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderApp(initialPath = '/') {
  vi.resetModules();
  const { App } = await import('../app/App');
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NestCloudWeb app', () => {
  it('shows login page when current account request fails', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () => createApiError(),
      },
    ]);

    await renderApp('/');

    expect(await screen.findByRole('heading', { name: '后台配置管理台' })).toBeInTheDocument();
  });

  it('logs in and lands on the first available system page', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () => createApiError(),
      },
      {
        method: 'POST',
        path: '/api/system/auth/login',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 100,
                code: 'system-management',
                name: '系统管理',
                routeName: null,
                icon: null,
                isEnabled: true,
                isHidden: false,
                isGroup: true,
                hideHeader: false,
                hideRoute: false,
                children: [
                  {
                    id: 101,
                    code: 'dictionary-namespace-management',
                    name: '命名空间管理',
                    routeName: 'dictionary-namespace',
                    icon: 'dictionary-namespace',
                    isEnabled: true,
                    isHidden: false,
                    isGroup: false,
                    hideHeader: false,
                    hideRoute: false,
                    children: [],
                  },
                ],
              },
            ],
          }),
      },
      {
        path: '/api/system/dictionaries/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            capabilities: ['dictionary', 'namespace'],
          }),
      },
      {
        path: '/api/system/dictionaries/namespaces',
        handle: () =>
          createApiResponse({
            list: [
              {
                namespace: 'theme',
                label: '主题',
                isEnabled: true,
                count: 1,
                description: '系统主题',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
    ]);

    const user = userEvent.setup();
    await renderApp('/login');

    await user.type(screen.getByLabelText('账号名'), 'admin');
    await user.type(screen.getByLabelText('密码'), 'secret');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('button', { name: '新增命名空间' })).toBeInTheDocument();
    expect(await screen.findByText('统一前端基座')).toBeInTheDocument();
  });

  it('redirects /system to the first available menu page', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 110,
                code: 'system-management',
                name: '系统管理',
                routeName: null,
                icon: null,
                isEnabled: true,
                isHidden: false,
                isGroup: true,
                hideHeader: false,
                hideRoute: false,
                children: [
                  {
                    id: 111,
                    code: 'dictionary-namespace-management',
                    name: '命名空间管理',
                    routeName: 'dictionary-namespace',
                    icon: 'dictionary-namespace',
                    isEnabled: true,
                    isHidden: false,
                    isGroup: false,
                    hideHeader: false,
                    hideRoute: false,
                    children: [],
                  },
                  {
                    id: 112,
                    code: 'dictionary-management',
                    name: '字典管理',
                    routeName: 'dictionary',
                    icon: 'dictionary',
                    isEnabled: true,
                    isHidden: false,
                    isGroup: false,
                    hideHeader: false,
                    hideRoute: false,
                    children: [],
                  },
                ],
              },
            ],
          }),
      },
      {
        path: '/api/system/dictionaries/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            capabilities: ['dictionary', 'namespace'],
          }),
      },
      {
        path: '/api/system/dictionaries/namespaces',
        handle: () =>
          createApiResponse({
            list: [
              {
                namespace: 'theme',
                label: '主题',
                isEnabled: true,
                count: 1,
                description: '系统主题',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
    ]);

    await renderApp('/system');

    expect(await screen.findByRole('button', { name: '新增命名空间' })).toBeInTheDocument();
    expect(screen.queryByText('页面不存在')).not.toBeInTheDocument();
  });

  it('loads dictionary namespace page inside system layout', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 1,
                code: 'dictionary-namespace-management',
                name: '命名空间管理',
                routeName: 'dictionary-namespace',
                icon: 'dictionary-namespace',
                isEnabled: true,
                isHidden: false,
                isGroup: false,
                hideHeader: false,
                hideRoute: false,
                children: [],
              },
            ],
          }),
      },
      {
        path: '/api/system/dictionaries/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            capabilities: ['dictionary', 'namespace'],
          }),
      },
      {
        path: '/api/system/dictionaries/namespaces',
        handle: () =>
          createApiResponse({
            list: [
              {
                namespace: 'theme',
                label: '主题',
                isEnabled: true,
                count: 1,
                description: '系统主题',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
    ]);

    const view = await renderApp('/system/dictionary-namespace');

    expect(await screen.findByText('命名空间列表')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '新增命名空间' })).toBeInTheDocument();
    expect(
      view.container.querySelector('img[src="/assert/svg/resource/dictionary-namespace.svg"]'),
    ).not.toBeNull();
  });

  it('loads dictionary page and shows aggregate list', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 2,
                code: 'dictionary-management',
                name: '字典管理',
                routeName: 'dictionary',
                icon: 'dictionary',
                isEnabled: true,
                isHidden: false,
                isGroup: false,
                hideHeader: false,
                hideRoute: false,
                children: [],
              },
            ],
          }),
      },
      {
        path: '/api/system/dictionaries/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            capabilities: ['dictionary', 'runtime'],
          }),
      },
      {
        path: '/api/system/dictionaries/namespaces',
        handle: () =>
          createApiResponse({
            list: [
              {
                namespace: 'theme',
                label: '主题',
                isEnabled: true,
                count: 1,
                description: '系统主题',
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 100,
            totalPages: 1,
          }),
      },
      {
        path: '/api/system/dictionaries/aggregates',
        handle: () =>
          createApiResponse({
            list: [
              {
                namespace: 'theme',
                aggregateKey: 'theme',
                label: '主题配置',
                description: '主题相关字典',
                count: 1,
                isEnabled: true,
                updatedAt: '2026-06-01T00:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
      {
        path: '/api/system/dictionaries/items',
        handle: () =>
          createApiResponse([
            {
              namespace: 'theme',
              aggregateKey: 'theme',
              key: 'default',
              label: '默认主题',
              value: 'aurora',
              description: '默认主题配置',
              isEnabled: true,
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ]),
      },
    ]);

    await renderApp('/system/dictionary');

    expect(await screen.findByText('主题配置')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导入字典项' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '字典项列表' })).not.toBeInTheDocument();
  });

  it('loads menu route page and keeps code readonly when editing', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 3,
                code: 'menu-route-management',
                name: '菜单管理',
                routeName: 'menu-route',
                icon: 'menu-route',
                isEnabled: true,
                isHidden: false,
                isGroup: false,
                hideHeader: false,
                hideRoute: false,
                children: [],
              },
            ],
          }),
      },
      {
        path: '/api/system/menu-routes/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            capabilities: ['menu-route', 'permission'],
          }),
      },
      {
        path: '/api/system/menu-routes/list',
        handle: () =>
          createApiResponse([
            {
              id: 11,
              code: 'system-management',
              name: '系统管理',
              path: 'system-management',
              parentId: null,
              component: 'dictionary-namespace',
              icon: 'system-management',
              sort: 10,
              isEnabled: true,
              isHidden: false,
              permissionCodes: ['system:view'],
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ]),
      },
      {
        path: '/api/system/permissions',
        handle: () =>
          createApiResponse({
            list: [
              {
                code: 'system:view',
                name: '查看系统管理',
                groupKey: 'system',
                description: '查看系统管理菜单',
                isEnabled: true,
              },
              {
                code: 'system:edit',
                name: '编辑系统管理',
                groupKey: 'system',
                description: '编辑系统管理菜单',
                isEnabled: true,
              },
            ],
            total: 2,
            page: 1,
            pageSize: 100,
            totalPages: 1,
          }),
      },
      {
        path: '/api/system/menu-routes/item',
        handle: () =>
          createApiResponse({
            id: 11,
            code: 'system-management',
            name: '系统管理',
            path: 'system-management',
            parentId: null,
            component: 'dictionary-namespace',
            redirect: null,
            icon: 'system-management',
            sort: 10,
            isEnabled: true,
            isHidden: false,
            permissionCodes: ['system:view'],
            meta: { group: true },
            updatedAt: '2026-06-01T00:00:00.000Z',
          }),
      },
    ]);

    const user = userEvent.setup();
    const view = await renderApp('/system/menu-route');

    expect(await screen.findByRole('button', { name: '新增菜单' })).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '编辑' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('.modal-dialog')).toHaveClass(
      'modal-xl',
      'modal-dialog-scrollable',
    );
    expect(within(dialog).getByText('权限绑定')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Code')).toHaveValue('system-management');
    expect(within(dialog).getByLabelText('Code')).toHaveAttribute('readonly');
  });

  it('loads account page and opens edit and role dialogs', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 4,
                code: 'account-management',
                name: '账号管理',
                routeName: 'account',
                icon: 'account',
                isEnabled: true,
                isHidden: false,
                isGroup: false,
                hideHeader: false,
                hideRoute: false,
                children: [],
              },
            ],
          }),
      },
      {
        path: '/api/system/accounts/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            capabilities: ['account', 'role'],
            avatarUpload: {
              uploadUrl: '/api/system/files/upload',
              scene: 'account-avatar',
              businessType: 'system-account',
              isTemporary: true,
            },
          }),
      },
      {
        path: '/api/system/accounts',
        handle: () =>
          createApiResponse({
            list: [
              {
                id: 21,
                accountName: 'admin',
                displayName: '管理员',
                isEnabled: true,
                avatarUrl: 'https://cdn.test/avatar/admin.png',
                remark: '系统管理员',
                roleCodes: ['admin'],
                failedLoginCount: 0,
                lockedUntil: null,
                lastLoginAt: '2026-06-01T08:00:00.000Z',
                updatedAt: '2026-06-01T09:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
      {
        path: '/api/system/roles/options',
        handle: () =>
          createApiResponse([
            {
              code: 'admin',
              name: '管理员',
            },
            {
              code: 'auditor',
              name: '审计员',
            },
          ]),
      },
      {
        path: '/api/system/accounts/item',
        handle: () =>
          createApiResponse({
            id: 21,
            accountName: 'admin',
            displayName: '管理员',
            isEnabled: true,
            avatarUrl: 'https://cdn.test/avatar/admin.png',
            remark: '系统管理员',
            roleCodes: ['admin'],
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: '2026-06-01T08:00:00.000Z',
            updatedAt: '2026-06-01T09:00:00.000Z',
          }),
      },
    ]);

    const user = userEvent.setup();
    const view = await renderApp('/system/account');

    expect(await screen.findByRole('button', { name: '查询' })).toBeInTheDocument();
    expect(await screen.findByText('账号名')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '编辑' }));

    expect(screen.getByLabelText('账号名')).toHaveValue('admin');
    expect(screen.getByLabelText('显示名')).toHaveValue('管理员');
    expect(screen.getByLabelText('头像 URL')).toHaveValue('https://cdn.test/avatar/admin.png');

    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(await screen.findByRole('button', { name: '角色' }));

    expect(await screen.findByText('账号角色：admin')).toBeInTheDocument();
    expect(screen.getByText('审计员')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存角色' })).toBeInTheDocument();
  });

  it('keeps account page stable while role options are still loading', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 4,
                code: 'account-management',
                name: '账号管理',
                routeName: 'account',
                icon: 'account',
                isEnabled: true,
                isHidden: false,
                isGroup: false,
                hideHeader: false,
                hideRoute: false,
                children: [],
              },
            ],
          }),
      },
      {
        path: '/api/system/accounts/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            capabilities: ['account', 'role'],
            avatarUpload: {
              uploadUrl: '/api/system/files/upload',
              scene: 'account-avatar',
              businessType: 'system-account',
              isTemporary: true,
            },
          }),
      },
      {
        path: '/api/system/accounts',
        handle: () =>
          createApiResponse({
            list: [
              {
                id: 21,
                accountName: 'admin',
                displayName: '管理员',
                isEnabled: true,
                avatarUrl: 'https://cdn.test/avatar/admin.png',
                remark: '系统管理员',
                roleCodes: ['admin'],
                failedLoginCount: 0,
                lockedUntil: null,
                lastLoginAt: '2026-06-01T08:00:00.000Z',
                updatedAt: '2026-06-01T09:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
      {
        path: '/api/system/roles/options',
        handle: () => new Promise<MockResponse>(() => {}) as unknown as MockResponse,
      },
    ]);

    const view = await renderApp('/system/account');

    expect(await screen.findByRole('button', { name: '查询' })).toBeInTheDocument();
    expect(await screen.findByText('账号名')).toBeInTheDocument();
  });

  it('loads login log page and renders dictionary labels', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 5,
                code: 'login-log-management',
                name: '登录日志',
                routeName: 'login-log',
                icon: 'login-log',
                isEnabled: true,
                isHidden: false,
                isGroup: false,
                hideHeader: false,
                hideRoute: false,
                children: [],
              },
            ],
          }),
      },
      {
        path: '/api/system/login-logs/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            capabilities: ['login-log', 'audit'],
          }),
      },
      {
        path: '/api/system/login-logs',
        handle: () =>
          createApiResponse({
            list: [
              {
                id: 100,
                accountName: 'admin',
                eventType: 'login-success',
                success: true,
                message: '登录成功',
                ip: '127.0.0.1',
                userAgent: 'Chrome',
                createdAt: '2026-06-01T08:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
      {
        path: '/api/system/dictionaries/runtime',
        handle: (url) => {
          const aggregateKey = url.searchParams.get('aggregateKey');
          if (aggregateKey === 'success-state') {
            return createApiResponse([
              {
                namespace: 'common',
                aggregateKey,
                key: 'success',
                value: true,
                label: '成功',
                isEnabled: true,
              },
              {
                namespace: 'common',
                aggregateKey,
                key: 'failure',
                value: false,
                label: '失败',
                isEnabled: true,
              },
            ]);
          }
          if (aggregateKey === 'login-log.event-type') {
            return createApiResponse([
              {
                namespace: 'common',
                aggregateKey,
                key: 'login-success',
                value: 'login-success',
                label: '登录成功',
                isEnabled: true,
              },
            ]);
          }
          throw new Error(`Unhandled dictionary aggregate: ${aggregateKey}`);
        },
      },
    ]);

    const view = await renderApp('/system/login-log');

    expect(await screen.findByRole('button', { name: '查询' })).toBeInTheDocument();
    expect((await screen.findAllByText('登录成功')).length).toBeGreaterThan(0);
    expect(
      view.container.querySelector('img[src="/assert/svg/observe/login-log.svg"]'),
    ).not.toBeNull();
  });

  it('loads operation log page and renders dictionary labels', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 6,
                code: 'operation-log-management',
                name: '操作日志',
                routeName: 'operation-log',
                icon: 'operation-log',
                isEnabled: true,
                isHidden: false,
                isGroup: false,
                hideHeader: false,
                hideRoute: false,
                children: [],
              },
            ],
          }),
      },
      {
        path: '/api/system/operation-logs/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            capabilities: ['operation-log', 'audit'],
          }),
      },
      {
        path: '/api/system/operation-logs',
        handle: () =>
          createApiResponse({
            list: [
              {
                id: 201,
                module: 'dictionary',
                action: 'update',
                targetType: 'dictionary-item',
                targetId: 'theme/default',
                summary: '更新默认主题',
                operator: 'admin',
                createdAt: '2026-06-01T09:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
      {
        path: '/api/system/dictionaries/runtime',
        handle: (url) => {
          const aggregateKey = url.searchParams.get('aggregateKey');
          if (aggregateKey === 'operation-log.module') {
            return createApiResponse([
              {
                namespace: 'common',
                aggregateKey,
                key: 'dictionary',
                value: 'dictionary',
                label: '字典资源',
                isEnabled: true,
              },
            ]);
          }
          if (aggregateKey === 'operation-log.action') {
            return createApiResponse([
              {
                namespace: 'common',
                aggregateKey,
                key: 'update',
                value: 'update',
                label: '更新',
                isEnabled: true,
              },
            ]);
          }
          if (aggregateKey === 'operation-log.target-type') {
            return createApiResponse([
              {
                namespace: 'common',
                aggregateKey,
                key: 'dictionary-item',
                value: 'dictionary-item',
                label: '字典项',
                isEnabled: true,
              },
            ]);
          }
          throw new Error(`Unhandled dictionary aggregate: ${aggregateKey}`);
        },
      },
    ]);

    const view = await renderApp('/system/operation-log');

    expect(await screen.findByRole('button', { name: '查询' })).toBeInTheDocument();
    expect(await screen.findByText('字典资源')).toBeInTheDocument();
    expect(await screen.findByText('更新默认主题')).toBeInTheDocument();
    expect(
      view.container.querySelector('img[src="/assert/svg/observe/operation-log.svg"]'),
    ).not.toBeNull();
  });

  it('loads service monitor page and renders metric cards', async () => {
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 7,
                code: 'service-monitor-management',
                name: '服务监控',
                routeName: 'service-monitor',
                icon: 'service-monitor',
                isEnabled: true,
                isHidden: false,
                isGroup: false,
                hideHeader: false,
                hideRoute: false,
                children: [],
              },
            ],
          }),
      },
      {
        path: '/api/system/monitors/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            onlineUserCount: 3,
            capabilities: ['service-monitor', 'online-user-monitor'],
          }),
      },
      {
        path: '/api/system/monitors/service',
        handle: () =>
          createApiResponse({
            collectedAt: '2026-06-01T10:00:00.000Z',
            cpu: {
              model: 'Intel(R) Test CPU',
              coreCount: 8,
              loadAverage: [0.12, 0.34, 0.56],
              uptimeSeconds: 7200,
            },
            memory: {
              totalBytes: 17179869184,
              freeBytes: 8589934592,
              usedBytes: 8589934592,
              usedPercent: 50,
              processRssBytes: 536870912,
              processHeapTotalBytes: 268435456,
              processHeapUsedBytes: 134217728,
            },
            disk: {
              path: 'C:/',
              available: true,
              totalBytes: 536870912000,
              freeBytes: 268435456000,
              usedBytes: 268435456000,
              usedPercent: 50,
            },
            server: {
              hostname: 'nest-cloud-dev',
              platform: 'win32',
              arch: 'x64',
              release: '11',
              nodeVersion: 'v22.0.0',
              pid: 12345,
            },
          }),
      },
    ]);

    const view = await renderApp('/system/service-monitor');

    expect(await screen.findByRole('heading', { name: '服务监控' })).toBeInTheDocument();
    expect(await screen.findByText('Intel(R) Test CPU')).toBeInTheDocument();
    expect(await screen.findByText('nest-cloud-dev')).toBeInTheDocument();
    expect(
      view.container.querySelector('img[src="/assert/svg/monitor/service-monitor.svg"]'),
    ).not.toBeNull();
  });

  it('loads online user monitor page and kicks a user offline', async () => {
    let onlineUsers = [
      {
        sessionId: 'session-1',
        accountId: 11,
        accountName: 'admin',
        displayName: '管理员',
        avatarUrl: 'https://cdn.test/avatar/admin.png',
        ip: '127.0.0.1',
        userAgent: 'Chrome on Windows',
        loginAt: '2026-06-01T08:00:00.000Z',
        lastActiveAt: '2026-06-01T09:00:00.000Z',
        expiresAt: '2026-06-01T12:00:00.000Z',
      },
    ];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    installFetchMock([
      {
        path: '/api/system/auth/current',
        handle: () =>
          createApiResponse({
            accountId: 1,
            accountName: 'admin',
            displayName: '管理员',
          }),
      },
      {
        path: '/api/system/runtime-permissions/current',
        handle: () =>
          createApiResponse({
            account: {
              id: 1,
              accountName: 'admin',
              displayName: '管理员',
            },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 8,
                code: 'online-user-monitor-management',
                name: '在线用户监控',
                routeName: 'online-user-monitor',
                icon: 'online-user-monitor',
                isEnabled: true,
                isHidden: false,
                isGroup: false,
                hideHeader: false,
                hideRoute: false,
                children: [],
              },
            ],
          }),
      },
      {
        path: '/api/system/monitors/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            onlineUserCount: onlineUsers.length,
            capabilities: ['service-monitor', 'online-user-monitor'],
          }),
      },
      {
        path: '/api/system/monitors/online-users',
        handle: () =>
          createApiResponse({
            list: onlineUsers,
            total: onlineUsers.length,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
      {
        method: 'DELETE',
        path: '/api/system/monitors/online-users',
        handle: async (_url, init) => {
          const payload = JSON.parse(String(init?.body ?? '{}')) as { sessionId?: string };
          onlineUsers = onlineUsers.filter((item) => item.sessionId !== payload.sessionId);
          return createApiResponse({ sessionId: payload.sessionId, kicked: true });
        },
      },
    ]);

    const user = userEvent.setup();
    const view = await renderApp('/system/online-user-monitor');

    expect(await screen.findByRole('button', { name: '查询' })).toBeInTheDocument();
    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument();
    expect(
      view.container.querySelector('img[src="/assert/svg/monitor/online-user-monitor.svg"]'),
    ).not.toBeNull();

    await user.click(await screen.findByRole('button', { name: '踢人下线' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(await screen.findByText('已踢下线')).toBeInTheDocument();
    expect(await screen.findByText('暂无在线用户数据')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
