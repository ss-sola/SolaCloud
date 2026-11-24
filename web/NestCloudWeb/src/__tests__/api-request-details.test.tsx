import { fireEvent, render, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AgentEvent, MethodGraph } from '../modules/system/api/apiCallGraph';
import { ApiMethodDiagram } from '../modules/system/components/ApiMethodDiagram';
import {
  applyEvents,
  emptyRecording,
  type RecordedRequest,
} from '../modules/system/utils/apiCallTrace';

const route = { id: 'POST /items/:id', method: 'POST', path: '/items/:id' };
const graph: MethodGraph = { nodes: [], roots: [], edges: [], warnings: [] };
const start = (requestId: string, seq: number): Extract<AgentEvent, { type: 'request' }> => ({
  type: 'request',
  routeId: route.id,
  method: route.method,
  path: '/items/' + requestId,
  startedAt: seq,
  seq,
  requestId,
});
const finish = (requestId: string, seq: number): Extract<AgentEvent, { type: 'end' }> => ({
  type: 'end',
  requestId,
  seq,
  status: 200,
  durationMs: 24,
  dropped: 0,
});
const diagram = (request?: RecordedRequest, interrupted = false) => (
  <ApiMethodDiagram graph={graph} route={route} request={request} interrupted={interrupted} />
);
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

it('keeps the open HTTP entry on the selected request and merges partial parameters in stream order', () => {
  const ui = render(diagram());
  fireEvent.click(ui.getByRole('button', { name: /^HTTP 入口/ }));
  const panel = within(ui.getByRole('region', { name: '入口详情' }));
  expect(panel.getByText('尚无请求记录。')).toBeVisible();
  const started = applyEvents(emptyRecording(), [
    {
      ...start('41', 1),
      requestHeaders: { authorization: '[已遮蔽]' },
      parameters: { query: { version: '2' }, body: 0 },
    },
    { ...start('42', 2), requestHeaders: { 'x-record': 'other' }, parameters: { query: {} } },
  ]);
  ui.rerender(diagram(started.requests.get('41')));
  const section = (name: string) => within(panel.getByRole('region', { name }));
  expect(section('请求头').getByText(/\[已遮蔽\]/)).toBeVisible();
  expect(section('请求参数').getByText('0')).toBeVisible();
  expect(section('请求参数').getByText('尚未采集')).toBeVisible();
  expect(section('响应头').getByText('等待响应…')).toBeVisible();
  const updated = applyEvents(started, [
    { type: 'requestParams', requestId: '41', seq: 3, parameters: { path: { id: '41' } } },
    { ...finish('42', 4), responseBody: '[无响应体]', responseHeaders: {} },
  ]);
  expect(started.requests.get('41')?.parameters?.path).toBeUndefined();
  ui.rerender(diagram(updated.requests.get('41')));
  expect(section('请求参数').getByText(/"id": "41"/)).toBeVisible();
  expect(section('请求参数').getByText(/"version": "2"/)).toBeVisible();
  expect(section('返回值').getByText('等待响应…')).toBeVisible();
  const done = applyEvents(updated, [
    {
      ...finish('41', 5),
      status: 404,
      parameters: { body: false },
      responseHeaders: { 'x-status': 'missing' },
      responseBody: null,
    },
  ]);
  ui.rerender(diagram(done.requests.get('41')));
  expect(panel.getByText(/HTTP 404.*24 ms/)).toBeVisible();
  expect(section('请求参数').getByText('false')).toBeVisible();
  expect(section('请求参数').getByText(/"version": "2"/)).toBeVisible();
  expect(section('请求参数').getByText(/"id": "41"/)).toBeVisible();
  expect(section('响应头').getByText(/missing/)).toBeVisible();
  expect(section('返回值').getByText('null')).toBeVisible();
  ui.rerender(diagram(done.requests.get('42')));
  expect(section('请求头').getByText(/other/)).toBeVisible();
  expect(section('请求参数').getByText('无查询参数')).toBeVisible();
  expect(section('响应头').getByText('无响应头')).toBeVisible();
  expect(section('返回值').getByText(/\[无响应体\]/)).toBeVisible();
  expect(panel.queryByText(/"id": "41"/)).toBeNull();
});

it.each([0, false, '', null])(
  'preserves an explicitly captured JSON value %j in both request and response',
  (value) => {
    const state = applyEvents(emptyRecording(), [
      { ...start('r', 1), parameters: { body: value }, requestHeaders: {} },
      { ...finish('r', 2), responseBody: value },
    ]);
    const ui = render(diagram(state.requests.get('r')));
    fireEvent.click(ui.getByRole('button', { name: /^HTTP 入口/ }));
    for (const name of ['请求参数', '返回值'])
      expect(
        within(ui.getByRole('region', { name })).getByText(JSON.stringify(value)),
      ).toBeVisible();
    expect(ui.getByText('无请求头')).toBeVisible();
    expect(within(ui.getByRole('region', { name: '响应头' })).getByText('未记录')).toBeVisible();
  },
);

it('distinguishes old completed records and interrupted requests awaiting a response', () => {
  const state = applyEvents(emptyRecording(), [
    start('old', 1),
    finish('old', 2),
    { ...start('interrupted', 3), requestHeaders: {}, parameters: { path: {}, query: {} } },
  ]);
  const ui = render(diagram(state.requests.get('old')));
  fireEvent.click(ui.getByRole('button', { name: /^HTTP 入口/ }));
  expect(ui.getByText(/旧版探针/)).toBeVisible();
  expect(ui.getByText(/HTTP 200.*24 ms/)).toBeVisible();
  ui.rerender(diagram(state.requests.get('interrupted'), true));
  expect(ui.getByText('无路径参数')).toBeVisible();
  expect(
    within(ui.getByRole('region', { name: '返回值' })).getByText('未收到响应结束记录'),
  ).toBeVisible();
});
