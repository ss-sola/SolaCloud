import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

interface MockHandler {
  method?: string;
  path: string;
  handle: (url: URL, init?: RequestInit) => MockResponse;
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
}

async function renderApp(initialPath: string) {
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MenuRoutePage', () => {
  it('does not render icon code text in the table', async () => {
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
            capabilities: ['menu-route'],
            itemCount: 1,
          }),
      },
      {
        path: '/api/system/menu-routes/list',
        handle: () =>
          createApiResponse([
            {
              id: 1,
              code: 'menu-route-management',
              name: '菜单管理',
              path: 'menu-route',
              parentId: null,
              component: 'menu-route',
              redirect: null,
              icon: '__menu_icon_code__',
              sort: 1,
              isEnabled: true,
              isHidden: false,
              permissionCodes: [],
              updatedAt: '2026-06-05T00:00:00.000Z',
            },
          ]),
      },
      {
        path: '/api/system/permissions',
        handle: () =>
          createApiResponse({
            list: [],
            total: 0,
            page: 1,
            pageSize: 100,
            totalPages: 1,
          }),
      },
    ]);

    await renderApp('/system/menu-route');

    expect(await screen.findByRole('heading', { name: '菜单树' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '新增菜单' })).toBeInTheDocument();
    expect(screen.queryByText('__menu_icon_code__')).not.toBeInTheDocument();
  });
});
