import { afterEach, expect, it, vi } from 'vitest';
import { RagApi } from '../modules/rag/api/ragApi';
import { ApiClient } from '../shared/api/apiClient';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('uses the page hostname on port 3100 by default and preserves query parameters', () => {
  vi.stubEnv('VITE_GATEWAY_ORIGIN', '');
  expect(
    ApiClient.buildUrl('/api/system/auth/current?foo=1', { keyword: ' 张 三 ', skip: '' }),
  ).toBe(
    `${location.protocol}//${location.hostname}:3100/api/system/auth/current?foo=1&keyword=%E5%BC%A0+%E4%B8%89`,
  );
});

it('sends JSON and SSE requests to the configured gateway with credentials', async () => {
  const gatewayOrigin = 'https://gateway.example.test';
  vi.stubEnv('VITE_GATEWAY_ORIGIN', `${gatewayOrigin}/`);
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ code: 200, data: {} }))
    .mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n'));
  vi.stubGlobal('fetch', fetchMock);

  await ApiClient.get('/api/system/auth/current');
  const onDone = vi.fn();
  const onError = vi.fn();
  const controller = RagApi.sendMessageStream(
    { sessionId: 1, query: 'test' },
    { onDone, onError, onToken: vi.fn(), onSources: vi.fn() },
  );

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    `${gatewayOrigin}/api/system/auth/current`,
    expect.objectContaining({ credentials: 'include' }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    `${gatewayOrigin}/api/chat/send`,
    expect.objectContaining({ method: 'POST', credentials: 'include', signal: controller.signal }),
  );
  await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(onError).not.toHaveBeenCalled();
});
