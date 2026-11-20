import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

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

describe('NotificationPage', () => {
  it('loads notification page and supports announcement save, message send, and mark all read', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const enabledAccounts = [
      {
        id: 1,
        accountName: 'admin',
        displayName: '管理员',
      },
      {
        id: 2,
        accountName: 'ops',
        displayName: '运维',
      },
    ];
    let announcements: Array<{
      id: number;
      title: string;
      content: string;
      isPublished: boolean;
      effectiveFrom: string | null;
      effectiveTo: string | null;
      publishedAt: string | null;
      revokedAt: null;
      publisherAccountId: number;
      createdAt: string;
      updatedAt: string;
    }> = [
      {
        id: 1,
        title: '维护通知',
        content: '今晚发布',
        isPublished: true,
        effectiveFrom: '2026-06-02T20:00:00.000Z',
        effectiveTo: '2026-06-02T22:00:00.000Z',
        publishedAt: '2026-06-02T18:00:00.000Z',
        revokedAt: null,
        publisherAccountId: 1,
        createdAt: '2026-06-02T18:00:00.000Z',
        updatedAt: '2026-06-02T18:00:00.000Z',
      },
    ];
    let messages: Array<{
      id: number;
      title: string;
      content: string;
      receiverAccountId: number;
      senderAccountId: number;
      isRead: boolean;
      readAt: string | null;
      createdAt: string;
      updatedAt: string;
    }> = [
      {
        id: 1,
        title: '欢迎使用',
        content: '请及时查看公告',
        receiverAccountId: 1,
        senderAccountId: 2,
        isRead: false,
        readAt: null,
        createdAt: '2026-06-02T08:00:00.000Z',
        updatedAt: '2026-06-02T08:00:00.000Z',
      },
    ];

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
                code: 'notification-management',
                name: '通知公告',
                routeName: 'notification',
                icon: 'notification',
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
        path: '/api/system/announcements/overview',
        handle: () =>
          createApiResponse({
            service: 'system-service',
            capabilities: ['announcement', 'station-message'],
            announcementCount: announcements.length,
            messageCount: messages.length,
          }),
      },
      {
        path: '/api/system/announcements',
        handle: () =>
          createApiResponse({
            list: announcements,
            total: announcements.length,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          }),
      },
      {
        path: '/api/system/announcements/runtime',
        handle: () => createApiResponse(announcements.filter((item) => item.isPublished)),
      },
      {
        method: 'POST',
        path: '/api/system/announcements',
        handle: async (_url, init) => {
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            title: string;
            content: string;
            isPublished?: boolean;
            effectiveFrom?: string;
            effectiveTo?: string;
          };
          const created = {
            id: announcements.length + 1,
            title: body.title,
            content: body.content,
            isPublished: body.isPublished ?? false,
            effectiveFrom: body.effectiveFrom ?? null,
            effectiveTo: body.effectiveTo ?? null,
            publishedAt: null,
            revokedAt: null,
            publisherAccountId: 1,
            createdAt: '2026-06-02T19:00:00.000Z',
            updatedAt: '2026-06-02T19:00:00.000Z',
          };
          announcements = [...announcements, created];
          return createApiResponse(created);
        },
      },
      {
        path: '/api/system/station-messages',
        handle: (url) => {
          const receiverAccountId = url.searchParams.get('receiverAccountId');
          const isRead = url.searchParams.get('isRead');
          let list = [...messages];
          if (receiverAccountId) {
            list = list.filter((item) => String(item.receiverAccountId) === receiverAccountId);
          }
          if (isRead === 'true' || isRead === 'false') {
            list = list.filter((item) => String(item.isRead) === isRead);
          }
          return createApiResponse({
            list,
            total: list.length,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          });
        },
      },
      {
        path: '/api/system/station-messages/runtime/current',
        handle: (url) => {
          const isRead = url.searchParams.get('isRead');
          let list = messages.filter((item) => item.receiverAccountId === 1);
          if (isRead === 'true' || isRead === 'false') {
            list = list.filter((item) => String(item.isRead) === isRead);
          }
          return createApiResponse(list);
        },
      },
      {
        path: '/api/system/station-messages/unread-count',
        handle: () =>
          createApiResponse(
            messages.filter((item) => item.receiverAccountId === 1 && !item.isRead).length,
          ),
      },
      {
        method: 'POST',
        path: '/api/system/station-messages/send',
        handle: async (_url, init) => {
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            title: string;
            content: string;
            isBroadcast?: boolean;
            receiverAccountIds?: number[];
          };
          const receiverIds = body.isBroadcast
            ? enabledAccounts.map((item) => item.id)
            : (body.receiverAccountIds ?? []);
          const created = receiverIds.map((receiverAccountId, index) => ({
            id: messages.length + index + 1,
            title: body.title,
            content: body.content,
            receiverAccountId,
            senderAccountId: 1,
            isRead: false,
            readAt: null,
            createdAt: '2026-06-02T20:00:00.000Z',
            updatedAt: '2026-06-02T20:00:00.000Z',
          }));
          messages = [...created, ...messages];
          return createApiResponse(created);
        },
      },
      {
        method: 'PUT',
        path: '/api/system/station-messages/read-all',
        handle: () => {
          const updatedItems = messages
            .filter((item) => item.receiverAccountId === 1 && !item.isRead)
            .map((item) => ({
              ...item,
              isRead: true,
              readAt: '2026-06-02T21:00:00.000Z',
              updatedAt: '2026-06-02T21:00:00.000Z',
            }));
          messages = messages.map((item) => {
            const matched = updatedItems.find((updated) => updated.id === item.id);
            return matched ?? item;
          });
          return createApiResponse({
            updatedCount: updatedItems.length,
            items: updatedItems,
          });
        },
      },
      {
        path: '/api/system/dictionaries/runtime',
        handle: (url) => {
          const aggregateKey = url.searchParams.get('aggregateKey');
          if (aggregateKey === 'notification.publish-state') {
            return createApiResponse([
              {
                namespace: 'common',
                aggregateKey,
                key: 'published',
                value: true,
                label: '已发布',
                isEnabled: true,
              },
              {
                namespace: 'common',
                aggregateKey,
                key: 'draft',
                value: false,
                label: '未发布',
                isEnabled: true,
              },
            ]);
          }
          if (aggregateKey === 'notification.read-state') {
            return createApiResponse([
              {
                namespace: 'common',
                aggregateKey,
                key: 'read',
                value: true,
                label: '已读',
                isEnabled: true,
              },
              {
                namespace: 'common',
                aggregateKey,
                key: 'unread',
                value: false,
                label: '未读',
                isEnabled: true,
              },
            ]);
          }
          if (aggregateKey === 'notification.send-mode') {
            return createApiResponse([
              {
                namespace: 'common',
                aggregateKey,
                key: 'account',
                value: 'account',
                label: '指定账号',
                isEnabled: true,
              },
              {
                namespace: 'common',
                aggregateKey,
                key: 'broadcast',
                value: 'broadcast',
                label: '广播',
                isEnabled: true,
              },
            ]);
          }
          throw new Error(`Unhandled dictionary aggregate: ${aggregateKey}`);
        },
      },
      {
        path: '/api/system/accounts/options',
        handle: () => createApiResponse(enabledAccounts),
      },
    ]);

    const user = userEvent.setup();
    await renderApp('/system/notification');

    expect(await screen.findByRole('button', { name: '新增公告' })).toBeInTheDocument();
    expect((await screen.findAllByText('维护通知')).length).toBeGreaterThan(0);
    expect(await screen.findByText('未读数：1')).toBeInTheDocument();

    await user.click((await screen.findAllByRole('button', { name: '新增公告' }))[0]);
    const announcementDialog = await screen.findByRole('dialog');
    await user.type(within(announcementDialog).getByLabelText('标题'), '系统升级');
    await user.type(within(announcementDialog).getByLabelText('内容'), '今晚 22:00 发布');
    await user.click(within(announcementDialog).getByRole('button', { name: '保存' }));

    expect(await screen.findByText('公告保存成功')).toBeInTheDocument();
    expect(await screen.findByText('系统升级')).toBeInTheDocument();

    await user.click((await screen.findAllByRole('button', { name: '发送站内信' }))[0]);
    const messageDialog = await screen.findByRole('dialog');
    await user.type(within(messageDialog).getByLabelText('标题'), '巡检提醒');
    await user.type(within(messageDialog).getByLabelText('内容'), '请检查服务状态');
    await user.selectOptions(within(messageDialog).getByLabelText('接收账号'), '1');
    await user.click(within(messageDialog).getByRole('button', { name: '发送' }));

    expect(await screen.findByText('站内信发送成功')).toBeInTheDocument();
    expect((await screen.findAllByText('巡检提醒')).length).toBeGreaterThan(0);
    expect(await screen.findByText('未读数：2')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '全部已读' }));
    expect(await screen.findByText('已处理 2 条站内信')).toBeInTheDocument();
    expect(await screen.findByText('未读数：0')).toBeInTheDocument();

    confirmSpy.mockRestore();
  });
});
