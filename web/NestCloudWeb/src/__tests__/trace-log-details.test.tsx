import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { TraceLogApi } from '../modules/system/api/traceLogApi';
import { TraceLogDetails } from '../modules/system/components/TraceLogDetails';

it('loads one authorized detail on demand and retains the complete log next to its HTTP sections', async () => {
  const message = JSON.stringify({
    upstreamAddress: '127.0.0.1:3201',
    error: 'client_disconnected',
    httpDetails: { requestHeaders: { state: 'captured', value: { cookie: '[REDACTED]' } } },
  });
  const fetchDetail = vi.spyOn(TraceLogApi, 'detail').mockResolvedValue({ message });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TraceLogDetails traceId="trace" entryId="entry" />
    </QueryClientProvider>,
  );
  expect(fetchDetail).not.toHaveBeenCalled();
  await user.click(screen.getByText('查看详情'));
  expect(await screen.findByRole('heading', { name: '请求头' })).toBeVisible();
  expect(screen.queryByText(message)).not.toBeInTheDocument();
  await user.click(screen.getByText('日志原文'));
  expect(await screen.findByText(message)).toBeVisible();
  expect(fetchDetail).toHaveBeenCalledTimes(1);
});
