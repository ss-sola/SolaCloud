import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AgentEvent, MethodGraph, ProjectRoute } from '../modules/system/api/apiCallGraph';
import { ApiCallGraphPage } from '../modules/system/pages/ApiCallGraphPage';
import {
  applyEvents,
  emptyRecording,
  maxProjectRequests,
  maxVisibleRequests,
} from '../modules/system/utils/apiCallTrace';
import { requestRouteResolver } from '../modules/system/utils/apiProbeRoute';

const first: ProjectRoute = {
  id: 'get:12',
  method: 'GET',
  path: '/version/:id',
  file: 'routes.ts',
  line: 12,
};
const second: ProjectRoute = { ...first, id: 'post:48', method: 'POST', line: 48 };
const node = { id: 'version:54', name: 'parseVersion', file: 'service.ts', line: 54 };
const graph: MethodGraph = { nodes: [node], edges: [], roots: [node.id], warnings: [] };
const request = (
  id: string,
  routeId?: string,
  method = 'GET',
  path = '/version/2',
): Extract<AgentEvent, { type: 'request' }> => ({
  type: 'request',
  seq: 1,
  requestId: id,
  startedAt: 1,
  routeId,
  path,
  method,
});

it('uses explicit scanner IDs and only attributes genuinely unique legacy method/path pairs', () => {
  const resolve = requestRouteResolver([
    first,
    second,
    { ...first, id: 'health', path: '/version/health' },
  ]);
  expect(resolve(request('a', first.id, 'GET', '/version/health'))).toBe(first.id);
  expect(resolve(request('a', 'unscanned'))).toBeUndefined();
  expect(resolve(request('a', undefined, 'GET', '/version/health'))).toBeUndefined();
  expect(resolve(request('a', undefined, 'GET', '/version/2?q=1'))).toBe(first.id);
  expect(resolve(request('a', undefined, 'POST', '/version/2'))).toBe(second.id);
  const captured = requestRouteResolver([
    first,
    { ...first, id: 'numeric', path: '/version/:id(\\d+)' },
  ]);
  expect(captured(request('a', undefined, 'GET', '/version/2'))).toBeUndefined();
  expect(captured(request('a', 'numeric', 'GET', '/version/2'))).toBe('numeric');
});

it('separates retention limits and keeps slow in-flight calls as newer routes finish', () => {
  let history = applyEvents(emptyRecording(), [request('slow', first.id)]);
  for (let i = 0; i < maxVisibleRequests + 5; i++) {
    history = applyEvents(history, [
      request('post' + i, second.id),
      { seq: 2, type: 'end', requestId: 'post' + i, status: 200, durationMs: 1, dropped: 0 },
    ]);
  }
  expect(history.requests.has('slow')).toBe(true);
  expect(history.requests.size).toBe(maxVisibleRequests + 1);
  for (let i = 0; i < maxProjectRequests; i++) {
    history = applyEvents(history, [
      request('req' + i, 'route' + i),
      { seq: 2, type: 'end', requestId: 'req' + i, status: 200, durationMs: 1, dropped: 0 },
    ]);
  }
  expect(history.requests.size).toBe(maxProjectRequests);
  expect(history.requests.has('slow')).toBe(true);
});

it('receives 16,000 calls through NDJSON, pages all results and switches interfaces within one running project', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
  const starts: unknown[] = [];
  let stops = 0,
    subscriptions = 0,
    seq = 0;
  let writer: ReadableStreamDefaultController<Uint8Array>;
  const reply = (data: unknown) => Response.json({ code: 200, data });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path.endsWith('/scan'))
        return reply({
          framework: 'nestjs',
          entry: 'dist/main.js',
          routes: [first, second],
          warnings: [],
        });
      if (path.endsWith('/graph')) return reply(graph);
      if (path.endsWith('/start')) {
        starts.push(JSON.parse(String(init?.body)));
        return reply({ sessionId: 'current' });
      }
      if (path.endsWith('/stop')) {
        stops++;
        return reply({ ok: true });
      }
      if (path.endsWith('/events')) {
        subscriptions++;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              writer = controller;
            },
          }),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      }
      throw Error(path);
    }),
  );
  const encoder = new TextEncoder();
  function send(events: AgentEvent[]) {
    writer.enqueue(
      encoder.encode(
        events.map((event) => JSON.stringify({ ...event, seq: ++seq })).join('\n') + '\n',
      ),
    );
  }
  function invocation(id: string, requestId: string, label: string): AgentEvent[] {
    return [
      { type: 'enter', seq: 0, requestId, callId: id, parentId: null, node, args: [label] },
      {
        type: 'leave',
        seq: 0,
        requestId,
        callId: id,
        state: 'ok',
        durationMs: 1.2,
        result: label + '-out',
      },
    ];
  }
  const ui = render(<ApiCallGraphPage />);
  fireEvent.click(ui.getByRole('button', { name: '扫描接口' }));
  fireEvent.click(await ui.findByRole('button', { name: '启动探针' }));
  expect(ui.getByText('NestJS · 2 / 2')).toBeVisible();
  await waitFor(() => expect(subscriptions).toBe(1));
  expect(starts).toEqual([{ project: 'E:\\project\\wzj-nodejs-v2' }]);
  expect(ui.getByLabelText('项目目录')).toBeDisabled();
  const count = 16000;
  await act(async () => {
    send([
      { type: 'status', seq: 0, state: 'listening', port: 40001 },
      { type: 'warning', seq: 0, message: 'reports.js 缺少源码映射' },
      { type: 'warning', seq: 0, message: 'reports.js 缺少源码映射' },
      request('get', first.id),
      request('post', second.id, 'POST'),
    ]);
    send(invocation('single', 'post', 'POST-only'));
    for (let begin = 0; begin < count; begin += 250) {
      const events: AgentEvent[] = [];
      for (let i = begin; i < Math.min(count, begin + 250); i++)
        events.push(...invocation(String(i + 1), 'get', 'GET-' + (i + 1)));
      send(events);
    }
  });
  fireEvent.click(ui.getByRole('button', { name: 'GET /version/:id' }));
  const method = await ui.findByRole('button', { name: 'parseVersion，已返回' });
  expect(ui.getByText('目标项目已监听')).toBeVisible();
  fireEvent.click(ui.getByText('探针提示（1）'));
  expect(ui.getByText('reports.js 缺少源码映射')).toBeVisible();
  await waitFor(() => expect(method).toHaveTextContent('16000 次'));
  expect(method).toHaveTextContent('#1 #2 #3 …');
  fireEvent.click(method);
  const details = within(ui.getByRole('region', { name: '方法详情' }));
  expect(details.getByText('"GET-16000-out"')).toBeVisible();
  expect(details.getByText('请求内顺序 #16000')).toBeVisible();
  const selection = details.getByRole('combobox') as HTMLSelectElement;
  expect(selection.options.length).toBe(101);
  fireEvent.click(details.getByRole('button', { name: '上一页' }));
  expect(details.getByText('15801–15900 / 16000')).toBeVisible();
  fireEvent.change(details.getByLabelText('本方法第几次调用'), { target: { value: '42' } });
  fireEvent.click(details.getByRole('button', { name: '跳转' }));
  expect(details.getByText('"GET-42-out"')).toBeVisible();
  expect(details.getByRole('option', { name: '第 42 次调用 · 请求 #42' })).toBeInTheDocument();
  expect(selection.options.length).toBe(101);
  await act(async () => send(invocation('16001', 'get', 'GET-16001')));
  await waitFor(() => expect(method).toHaveTextContent('16001 次'));
  expect(details.getByText('"GET-42-out"')).toBeVisible();
  fireEvent.change(selection, { target: { value: '' } });
  expect(details.getByText('"GET-16001-out"')).toBeVisible();
  fireEvent.change(ui.getByLabelText('请求记录'), { target: { value: 'get' } });
  async function switchTo(method: string) {
    fireEvent.click(ui.getByRole('button', { name: '切换接口' }));
    const picker = within(await ui.findByRole('dialog'));
    expect(picker.getByLabelText('项目目录')).toBeDisabled();
    fireEvent.click(picker.getByRole('button', { name: method + ' /version/:id' }));
    await ui.findByRole('heading', { name: method + ' /version/:id' });
    return await ui.findByRole('button', { name: 'parseVersion，已返回' });
  }
  const post = await switchTo('POST');
  expect(post).toHaveTextContent('1 次');
  fireEvent.click(post);
  expect(ui.getByText('"POST-only-out"')).toBeVisible();
  expect((ui.getByLabelText('请求记录') as HTMLSelectElement).options).toHaveLength(2);
  const get = await switchTo('GET');
  expect(get).toHaveTextContent('16001 次');
  expect(ui.getByLabelText('请求记录')).toHaveValue('get');
  expect(starts).toHaveLength(1);
  expect(subscriptions).toBe(1);
  expect(stops).toBe(0);
  await act(async () => {
    send([{ type: 'status', seq: 0, state: 'stopped' }]);
    writer.close();
  });
  expect(await ui.findByText('探针已停止')).toBeVisible();
}, 15000);
