import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('DictionaryPage', () => {
  it('keeps dictionary item management inside the aggregate edit modal', async () => {
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
            capabilities: ['dictionary'],
            itemCount: 1,
          }),
      },
      {
        path: '/api/system/dictionaries/namespaces',
        handle: () =>
          createApiResponse({
            list: [
              {
                id: 1,
                namespace: 'common',
                label: '公共字典',
                isEnabled: true,
                updatedAt: '2026-06-05T00:00:00.000Z',
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
                id: 1,
                namespace: 'common',
                aggregateKey: 'theme',
                label: '主题',
                description: '主题色方案',
                isEnabled: true,
                count: 1,
                updatedAt: '2026-06-05T00:00:00.000Z',
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
              id: 1,
              namespace: 'common',
              aggregateKey: 'theme',
              key: 'primary',
              label: '主色',
              value: 'aurora',
              description: '主色主题',
              isEnabled: true,
              updatedAt: '2026-06-05T00:00:00.000Z',
            },
          ]),
      },
    ]);

    const user = userEvent.setup();
    await renderApp('/system/dictionary');

    expect(await screen.findByRole('heading', { name: '字典列表' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '字典项列表' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导入字典项' })).not.toBeInTheDocument();
    expect(screen.queryByText('请选择字典后查看和维护字典项。')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '编辑' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('.modal-dialog')).toHaveClass(
      'modal-xl',
      'modal-dialog-scrollable',
    );
    expect(within(dialog).getByRole('heading', { name: '字典项列表' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '新增字典项' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '批量导入' })).toBeInTheDocument();
    expect(within(dialog).queryByText('每页条数')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '上一页' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('primary')).toBeInTheDocument();
  });
});
