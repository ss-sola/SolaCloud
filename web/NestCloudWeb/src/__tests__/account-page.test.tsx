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
      // Return empty responses for unhandled requests to avoid errors
      return createApiResponse([]);
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

describe('AccountPage', () => {
  it('renders account list with account entries', async () => {
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
            account: { id: 1, accountName: 'admin', displayName: '管理员' },
            roleCodes: ['admin'],
            menuTree: [
              {
                id: 1,
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
          createApiResponse({ service: 'system-service', capabilities: ['account'], itemCount: 2 }),
      },
      {
        path: '/api/system/accounts',
        method: 'GET',
        handle: () =>
          createApiResponse({
            list: [
              {
                id: 1,
                accountName: 'admin',
                displayName: '管理员',
                isEnabled: true,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
              {
                id: 2,
                accountName: 'operator',
                displayName: '操作员',
                isEnabled: true,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            total: 2,
            pageNum: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
    ]);

    await renderApp('/system/account');

    // Wait for page to load
    await screen.findByText(/管理员/i);
    expect(screen.getByText(/管理员/i)).toBeInTheDocument();
  });
});
