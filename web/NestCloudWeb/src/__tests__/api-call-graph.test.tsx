import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  ApiCallGraph,
  type AgentEvent,
  type MethodGraph,
  type ProjectRoute,
} from '../modules/system/api/apiCallGraph';
import { ApiCallGraphPage } from '../modules/system/pages/ApiCallGraphPage';
import { ApiMethodDiagram } from '../modules/system/components/ApiMethodDiagram';
import { applyEvents, emptyRecording, layoutMethods } from '../modules/system/utils/apiCallTrace';

const node = { id: 'version', file: 'src/service/version.ts', line: 12, name: 'getVersion' };
const child = { ...node, id: 'compare', name: 'compare' };
const route: ProjectRoute = {
  id: 'GET /version',
  method: 'GET',
  path: '/version',
  file: 'src/api/version.ts',
  line: 3,
};
const graph: MethodGraph = {
  nodes: [node, child],
  edges: [{ from: node.id, to: child.id }],
  roots: [node.id],
  warnings: [],
};

describe('接口调用图', () => {
  it('keeps the current graph when browsing interfaces or entering and leaving fullscreen', async () => {
    // jsdom exposes dialog.open but does not implement native top-layer behavior.
    const dialogPrototype = HTMLDialogElement.prototype;
    if (!dialogPrototype.showModal) {
      dialogPrototype.showModal = function () {
        this.open = true;
      };
      dialogPrototype.close = function () {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      };
      onTestFinished(() => {
        Reflect.deleteProperty(dialogPrototype, 'showModal');
        Reflect.deleteProperty(dialogPrototype, 'close');
      });
    }
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const second = { ...route, id: 'GET /latest', path: '/latest' };
    vi.spyOn(ApiCallGraph, 'scan').mockResolvedValue({ routes: [route, second], warnings: [] });
    const load = vi.spyOn(ApiCallGraph, 'graph').mockResolvedValue(graph);
    const ui = render(<ApiCallGraphPage />);
    fireEvent.click(ui.getByRole('button', { name: '扫描接口' }));
    fireEvent.click(await ui.findByRole('button', { name: route.id }));
    fireEvent.click(await ui.findByRole('button', { name: 'getVersion，待采集' }));
    const workspace = ui.getByRole('region', { name: '接口调用图' });
    const svg = ui.getByLabelText('方法调用流程图');
    expect(ui.queryByRole('searchbox', { name: '搜索接口' })).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: '全屏' }));
    expect(workspace).toHaveAttribute('data-expanded');
    fireEvent.click(ui.getByRole('button', { name: '切换接口' }));
    const dialog = await ui.findByRole('dialog', { name: '选择项目和接口' });
    expect(within(dialog).getByRole('searchbox', { name: '搜索接口' })).toHaveFocus();
    fireEvent.change(within(dialog).getByLabelText('项目目录'), { target: { value: 'Z:/other' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(ui.queryByRole('dialog')).toBeNull());
    fireEvent.keyDown(workspace, { key: 'Escape' });
    expect(workspace).not.toHaveAttribute('data-expanded');
    expect(ui.getByLabelText('方法调用流程图')).toBe(svg);
    expect(ui.getByRole('region', { name: '方法详情' })).toHaveTextContent('getVersion');
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.click(ui.getByRole('button', { name: '切换接口' }));
    fireEvent.click(within(await ui.findByRole('dialog')).getByRole('button', { name: second.id }));
    expect(await ui.findByRole('heading', { name: 'GET /latest' })).toBeVisible();
    expect(load).toHaveBeenLastCalledWith(
      'E:\\project\\wzj-nodejs-v2',
      second.id,
      expect.any(AbortSignal),
    );
  });

  it('lays out cycles and shared children exactly once', () => {
    const layout = layoutMethods(
      graph.nodes,
      [...graph.edges, { from: child.id, to: node.id }],
      graph.roots,
    );
    expect([...layout.positions.keys()]).toEqual(['version', 'compare']);
    expect(layout.positions.get('compare')!.y).toBeGreaterThan(layout.positions.get('version')!.y);
  });

  it('projects real activity through hidden calls and preserves visible details while filters change', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const callback = { ...node, id: 'callback', name: 'map 回调', anonymous: true };
    const middle = { ...node, id: 'middle', name: 'readCache' };
    const methods: MethodGraph = {
      ...graph,
      nodes: [node, callback, middle, child],
      edges: [
        { from: node.id, to: callback.id },
        { from: callback.id, to: middle.id },
        { from: middle.id, to: child.id },
      ],
    };
    const initial = applyEvents(emptyRecording(), [
      { seq: 1, type: 'request', requestId: 'req', method: 'GET', path: '/version', startedAt: 1 },
      ...[node, callback, middle, child].map((n, i) => ({
        seq: i + 2,
        type: 'enter' as const,
        requestId: 'req',
        callId: String(i),
        parentId: i ? String(i - 1) : null,
        node: n,
        args: [n.name],
      })),
    ]);
    const ui = render(
      <ApiMethodDiagram
        graph={methods}
        request={initial.requests.get('req')}
        interrupted={false}
      />,
    );
    const edge = (from: string, to: string) =>
      ui.container.querySelector(`[data-from="${from}"][data-to="${to}"]`);
    expect(ui.queryByRole('button', { name: /map 回调/ })).toBeNull();
    expect(edge(node.id, middle.id)).toHaveAttribute('data-state', 'running');
    expect(ui.getByRole('button', { name: 'compare，执行中' })).toHaveTextContent('#4');
    fireEvent.click(ui.getByRole('button', { name: 'compare，执行中' }));
    fireEvent.click(ui.getByRole('button', { name: '过滤方法' }));
    const search = ui.getByRole('searchbox', { name: '搜索方法' });
    fireEvent.change(search, { target: { value: 'readCache' } });
    fireEvent.click(ui.getByRole('checkbox', { name: /隐藏 readCache/ }));
    expect(ui.queryByRole('button', { name: 'readCache，执行中' })).toBeNull();
    expect(edge(node.id, child.id)).toHaveAttribute('data-state', 'running');
    expect(ui.getByRole('button', { name: 'compare，执行中' })).toHaveTextContent('#4');
    expect(edge(node.id, child.id)?.querySelector('path[pathLength]')).toBeTruthy();
    expect(ui.getByRole('region', { name: '方法详情' })).toHaveTextContent('compare');
    const completed = applyEvents(initial, [
      {
        seq: 6,
        type: 'leave',
        requestId: 'req',
        callId: '3',
        state: 'error',
        result: 'failed',
        durationMs: 2,
      },
      {
        seq: 7,
        type: 'leave',
        requestId: 'req',
        callId: '2',
        state: 'ok',
        result: null,
        durationMs: 4,
      },
      {
        seq: 8,
        type: 'leave',
        requestId: 'req',
        callId: '1',
        state: 'ok',
        result: null,
        durationMs: 6,
      },
      {
        seq: 9,
        type: 'leave',
        requestId: 'req',
        callId: '0',
        state: 'ok',
        result: 'fallback',
        durationMs: 7,
      },
      { seq: 10, type: 'end', requestId: 'req', status: 200, durationMs: 8, dropped: 0 },
    ]);
    ui.rerender(
      <ApiMethodDiagram
        graph={methods}
        request={completed.requests.get('req')}
        interrupted={false}
      />,
    );
    expect(edge(node.id, child.id)).toHaveAttribute('data-state', 'error');
    expect(edge(node.id, child.id)?.querySelector('path[pathLength]')).toBeNull();
    expect(ui.getByRole('button', { name: 'getVersion，已返回' })).toHaveAttribute(
      'data-state',
      'completed',
    );
    expect(ui.getByRole('region', { name: '方法详情' })).toHaveTextContent('failed');
    fireEvent.click(ui.getByRole('button', { name: '收起 getVersion 的下游方法' }));
    expect(ui.queryByRole('button', { name: /^compare，/ })).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: '展开 getVersion 的下游方法' }));
    expect(ui.getByRole('button', { name: /^compare，/ })).toHaveTextContent('#4');
    fireEvent.change(search, { target: { value: 'getVersion' } });
    fireEvent.click(ui.getByRole('checkbox', { name: /隐藏 getVersion/ }));
    expect(ui.queryByRole('button', { name: 'getVersion，已返回' })).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: '清除过滤' }));
    expect(ui.getByRole('button', { name: 'getVersion，已返回' })).toBeVisible();
    fireEvent.click(ui.getByRole('button', { name: /定位 getVersion/ }));
    expect(ui.getByRole('region', { name: '方法详情' })).toHaveTextContent('fallback');
    expect(ui.queryByRole('region', { name: '过滤方法' })).toBeNull();
  });

  it('selects static routes before starting, then streams separate concurrent requests and repeated invocations', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(ApiCallGraph, 'scan').mockResolvedValue({
      routes: [route],
      workerEntries: ['dist/jobs.js', 'dist/mail.cjs'],
      warnings: [],
    });
    const load = vi.spyOn(ApiCallGraph, 'graph').mockResolvedValue(graph);
    const start = vi.spyOn(ApiCallGraph, 'start').mockResolvedValue({ sessionId: 'session' });
    const stop = vi.spyOn(ApiCallGraph, 'stop').mockResolvedValue({ ok: true });
    let receive: (event: AgentEvent) => void;
    vi.spyOn(ApiCallGraph, 'events').mockImplementation(async (_id, _after, signal, onEvent) => {
      receive = (event) => onEvent(event, true);
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
    });
    const screen = render(<ApiCallGraphPage />);
    fireEvent.click(screen.getByRole('button', { name: '扫描接口' }));
    fireEvent.click(await screen.findByRole('button', { name: 'GET /version' }));
    expect(screen.getByText('已识别 2 个独立 BullMQ Worker 入口')).toBeVisible();
    expect(screen.queryByLabelText(/Worker 入口文件/)).toBeNull();
    expect(await screen.findByRole('button', { name: 'getVersion，待采集' })).toBeVisible();
    expect(screen.queryByText(/^#\d/)).toBeNull();
    expect(load).toHaveBeenCalledWith(
      'E:\\project\\wzj-nodejs-v2',
      route.id,
      expect.any(AbortSignal),
    );
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '启动探针' }));
    expect(start).toHaveBeenCalledWith('E:\\project\\wzj-nodejs-v2');
    await waitFor(() => expect(receive).toBeDefined());
    act(() => {
      receive({ seq: 1, type: 'status', state: 'listening', port: 4399 });
      receive({
        seq: 2,
        type: 'request',
        requestId: 'first',
        method: 'GET',
        path: '/version',
        startedAt: 1,
      });
      receive({
        seq: 3,
        type: 'enter',
        requestId: 'first',
        node,
        callId: 'a',
        parentId: null,
        args: ['alpha'],
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'getVersion，执行中' }));
    expect(screen.getByText('等待返回…')).toBeVisible();
    act(() => {
      receive({
        seq: 4,
        type: 'request',
        requestId: 'second',
        method: 'GET',
        path: '/version',
        startedAt: 2,
      });
      receive({
        seq: 5,
        type: 'enter',
        requestId: 'second',
        node,
        callId: 'a',
        parentId: null,
        args: ['beta'],
      });
      receive({
        seq: 6,
        type: 'leave',
        requestId: 'second',
        callId: 'a',
        result: 'other',
        durationMs: 2,
        state: 'ok',
      });
      receive({
        seq: 7,
        type: 'leave',
        requestId: 'first',
        callId: 'a',
        result: 'old',
        durationMs: 1,
        state: 'ok',
      });
      receive({
        seq: 8,
        type: 'enter',
        requestId: 'first',
        node,
        callId: 'b',
        parentId: null,
        args: ['again'],
      });
      receive({
        seq: 9,
        type: 'leave',
        requestId: 'first',
        callId: 'b',
        result: 'bad',
        durationMs: 3,
        state: 'error',
      });
      receive({ seq: 10, type: 'end', requestId: 'first', status: 400, durationMs: 8, dropped: 0 });
    });
    expect(await screen.findByText('"other"')).toBeVisible();
    expect(screen.getByText('请求内顺序 #1')).toBeVisible();
    fireEvent.change(screen.getByLabelText('请求记录'), { target: { value: 'first' } });
    const detail = within(screen.getByRole('region', { name: '方法详情' }));
    expect(detail.getByText('"bad"')).toBeVisible();
    expect(detail.getByText('请求内顺序 #2')).toBeVisible();
    expect(screen.getByRole('button', { name: /^getVersion，/ })).toHaveTextContent('#1 #2');
    fireEvent.change(detail.getByRole('combobox'), { target: { value: 'a' } });
    expect(detail.getByText('"old"')).toBeVisible();
    expect(detail.getByRole('combobox')).toHaveDisplayValue('第 1 次调用 · 请求 #1');
    expect(screen.getByRole('button', { name: 'compare，未执行' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '停止探针' }));
    expect(stop).toHaveBeenCalledWith('session');
    act(() => receive({ seq: 11, type: 'status', state: 'stopped' }));
    expect(await screen.findByText('探针已停止')).toBeVisible();
    expect(screen.getByRole('button', { name: '启动探针' })).toBeEnabled();
  });

  it('pulses once for live returns within one flush, without changing timing or replaying a historical result', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    let reduceMotion = false;
    vi.stubGlobal('matchMedia', () => ({ matches: reduceMotion }));
    const animate = vi.fn();
    const animation = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'animate');
    Object.defineProperty(SVGElement.prototype, 'animate', { configurable: true, value: animate });
    try {
      vi.spyOn(ApiCallGraph, 'scan').mockResolvedValue({ routes: [route], warnings: [] });
      vi.spyOn(ApiCallGraph, 'graph').mockResolvedValue(graph);
      vi.spyOn(ApiCallGraph, 'start').mockResolvedValue({ sessionId: 'session' });
      vi.spyOn(ApiCallGraph, 'stop').mockResolvedValue({ ok: true });
      let receive: (event: AgentEvent, live: boolean) => void;
      vi.spyOn(ApiCallGraph, 'events').mockImplementation(async (_id, _after, signal, onEvent) => {
        receive = onEvent;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      });
      const ui = render(<ApiCallGraphPage />);
      fireEvent.click(ui.getByRole('button', { name: '扫描接口' }));
      fireEvent.click(await ui.findByRole('button', { name: 'GET /version' }));
      fireEvent.click(await ui.findByRole('button', { name: 'getVersion，待采集' }));
      fireEvent.click(ui.getByRole('button', { name: '启动探针' }));
      await waitFor(() => expect(receive).toBeDefined());
      let seq = 0;
      function finish(id: string, live: boolean) {
        receive(
          {
            type: 'request',
            seq: ++seq,
            requestId: id,
            path: '/version',
            method: 'GET',
            startedAt: 1,
          },
          live,
        );
        receive(
          {
            type: 'enter',
            seq: ++seq,
            requestId: id,
            callId: 'parent',
            parentId: null,
            node,
            args: [],
          },
          live,
        );
        receive(
          {
            type: 'enter',
            seq: ++seq,
            requestId: id,
            callId: 'child',
            parentId: 'parent',
            node: child,
            args: [],
          },
          live,
        );
        receive(
          {
            type: 'leave',
            seq: ++seq,
            requestId: id,
            callId: 'child',
            state: 'ok',
            result: id,
            durationMs: 0.3,
          },
          live,
        );
        receive(
          {
            type: 'leave',
            seq: ++seq,
            requestId: id,
            callId: 'parent',
            state: 'ok',
            result: id,
            durationMs: 1,
          },
          live,
        );
        receive(
          { type: 'end', seq: ++seq, requestId: id, status: 200, durationMs: 1.5, dropped: 0 },
          live,
        );
      }
      act(() => finish('history', false));
      await ui.findByText('"history"');
      expect(animate).not.toHaveBeenCalled();
      act(() => finish('live', true));
      await ui.findByText('"live"');
      expect(animate).toHaveBeenCalledTimes(2);
      const entryEdge = ui.container.querySelector('[data-from="http:entry"][data-to="version"]');
      const actualEdge = ui.container.querySelector('[data-from="version"][data-to="compare"]');
      expect(entryEdge).toHaveAttribute('data-state', 'completed');
      expect(actualEdge).toHaveAttribute('data-state', 'completed');
      expect(animate.mock.instances).toContain(entryEdge?.querySelector('[data-return-seq]'));
      expect(animate.mock.instances).toContain(actualEdge?.querySelector('[data-return-seq]'));
      expect(ui.getByRole('button', { name: 'compare，已返回' })).toHaveTextContent('0.30 ms');
      fireEvent.click(ui.getByRole('button', { name: '过滤方法' }));
      const exclude = ui.getByRole('checkbox', { name: /隐藏 compare/ });
      fireEvent.click(exclude);
      fireEvent.click(exclude);
      fireEvent.change(ui.getByLabelText('请求记录'), { target: { value: 'history' } });
      fireEvent.change(ui.getByLabelText('请求记录'), { target: { value: '' } });
      expect(animate).toHaveBeenCalledTimes(2);
      reduceMotion = true;
      act(() => finish('reduced', true));
      await ui.findByText('"reduced"');
      expect(animate).toHaveBeenCalledTimes(2);
    } finally {
      if (animation) Object.defineProperty(SVGElement.prototype, 'animate', animation);
      else Reflect.deleteProperty(SVGElement.prototype, 'animate');
    }
  });

  it('decodes fragmented NDJSON and distinguishes replay from live frames at the gateway cursor', async () => {
    const data = new TextEncoder().encode(
      '{"seq":8,"type":"status","state":"starting"}\n\n{"seq":9,"type":"status","state":"listening","message":"已启动"}\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data.slice(0, -6));
        controller.enqueue(data.slice(-6));
        controller.close();
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const onEvent = vi.fn();
    await ApiCallGraph.events('session', 7, new AbortController().signal, onEvent);
    expect(onEvent).toHaveBeenNthCalledWith(
      1,
      { seq: 8, type: 'status', state: 'starting' },
      false,
    );
    expect(onEvent).toHaveBeenNthCalledWith(
      2,
      {
        seq: 9,
        type: 'status',
        state: 'listening',
        message: '已启动',
      },
      true,
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/call-graph/events?sessionId=session&after=7'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
