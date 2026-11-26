import { fireEvent, render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { MethodGraph, MethodNode } from '../modules/system/api/apiCallGraph';
import { ApiMethodDiagram } from '../modules/system/components/ApiMethodDiagram';
import { applyEvents, emptyRecording } from '../modules/system/utils/apiCallTrace';

const method = (id: string, computationOnly?: boolean): MethodNode => ({
  id,
  name: id,
  file: 'version.ts',
  line: 1,
  computationOnly,
});
const root = method('handle'),
  helper = method('Version.fromString', true),
  sibling = method('findVersion', false),
  leaf = method('compareVersion');
const graph: MethodGraph = {
  nodes: [root, helper, sibling, leaf],
  edges: [
    { from: root.id, to: helper.id },
    { from: helper.id, to: leaf.id },
    { from: sibling.id, to: leaf.id },
  ],
  roots: [root.id, sibling.id],
  warnings: [],
};
const route = { id: 'GET /version', method: 'GET', path: '/version' };

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

it('filters only confirmed local computation and counts overlapping manual filters once', () => {
  const ui = render(<ApiMethodDiagram route={route} graph={graph} interrupted={false} />);
  const edge = (from: string, to: string) =>
    ui.container.querySelector(`[data-from="${from}"][data-to="${to}"]`);
  fireEvent.click(ui.getByRole('button', { name: '过滤方法（1）' }));
  const mode = ui.getByRole('switch', { name: '过滤静态方法' });
  const manual = ui.getByRole('checkbox', { name: /隐藏 Version\.fromString/ });
  const locate = ui.getByRole('button', { name: /定位 Version\.fromString/ });
  expect(mode).toBeChecked();
  expect(manual).toBeChecked();
  expect(manual).toBeDisabled();
  expect(edge(root.id, leaf.id)).toHaveAttribute('data-state', 'idle');
  fireEvent.click(mode);
  expect(manual).not.toBeChecked();
  fireEvent.click(manual);
  fireEvent.click(mode);
  expect(manual).toBeChecked();
  expect(manual).toBeDisabled();
  expect(ui.getByRole('button', { name: '过滤方法（1）' })).toBeVisible();
  expect(ui.queryByRole('button', { name: 'Version.fromString，待采集' })).toBeNull();
  expect(edge(root.id, leaf.id)).toHaveAttribute('data-state', 'idle');
  expect(edge(sibling.id, leaf.id)).toHaveAttribute('data-state', 'idle');
  expect(locate).toBeDisabled();
  fireEvent.click(mode);
  expect(manual).toBeChecked();
  expect(manual).toBeEnabled();
  expect(locate).toBeDisabled();
  fireEvent.click(manual);
  expect(manual).not.toBeChecked();
  fireEvent.click(mode);
  expect(manual).toBeChecked();
  expect(locate).toBeDisabled();
  const db = ui.getByRole('checkbox', { name: /隐藏 findVersion/ });
  expect(db).not.toBeChecked();
  expect(db).toBeEnabled();
  fireEvent.click(db);
  expect(ui.getByRole('button', { name: '过滤方法（2）' })).toBeVisible();
  fireEvent.click(mode);
  expect(manual).not.toBeChecked();
  expect(db).toBeChecked();
  expect(ui.getByRole('button', { name: 'Version.fromString，待采集' })).toBeVisible();
  expect(locate).toBeEnabled();
  expect(ui.getByRole('button', { name: '过滤方法（1）' })).toBeVisible();
  fireEvent.click(mode);
  fireEvent.click(ui.getByRole('button', { name: '清除过滤' }));
  expect(mode).not.toBeChecked();
  expect(manual).not.toBeChecked();
  expect(db).not.toBeChecked();
  expect(ui.getByRole('button', { name: '清除过滤' })).toBeDisabled();
  fireEvent.click(locate);
  expect(ui.getByRole('region', { name: '方法详情' })).toHaveTextContent('Version.fromString');
});

it('projects a probe-only calculation onto real visible ancestors and restores its actual inputs', () => {
  const extra = method('Version.parse', true);
  const traced = applyEvents(emptyRecording(), [
    { seq: 1, type: 'request', requestId: 'req', method: 'GET', path: '/version', startedAt: 1 },
    { seq: 2, type: 'enter', requestId: 'req', callId: 'r', parentId: null, node: root, args: [] },
    {
      seq: 3,
      type: 'enter',
      requestId: 'req',
      callId: 'd',
      parentId: 'r',
      node: extra,
      args: ['demo'],
    },
    { seq: 4, type: 'enter', requestId: 'req', callId: 'l', parentId: 'd', node: leaf, args: [] },
  ]);
  const req = traced.requests.get('req')!;
  const ui = render(
    <ApiMethodDiagram route={route} graph={graph} request={req} interrupted={false} />,
  );
  fireEvent.click(ui.getByRole('checkbox', { name: /显示探针补充的方法/ }));
  const edge = (from: string, to: string) =>
    ui.container.querySelector(`[data-from="${from}"][data-to="${to}"]`);
  expect(edge(extra.id, leaf.id)).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: '过滤方法（2）' }));
  expect(ui.getByRole('switch', { name: '过滤静态方法' })).toBeChecked();
  expect(ui.queryByRole('button', { name: 'Version.parse，执行中' })).toBeNull();
  expect(ui.getByRole('checkbox', { name: /隐藏 Version\.parse/ })).toBeChecked();
  expect(ui.getByRole('button', { name: '过滤方法（2）' })).toBeVisible();
  expect(edge(root.id, leaf.id)).toHaveAttribute('data-state', 'running');
  expect(edge(sibling.id, leaf.id)).toHaveAttribute('data-state', 'idle');
  expect(ui.getByRole('button', { name: /定位 Version\.parse/ })).toBeDisabled();
  fireEvent.click(ui.getByRole('checkbox', { name: /显示探针补充的方法/ }));
  expect(ui.getByRole('button', { name: '过滤方法（1）' })).toBeVisible();
  fireEvent.click(ui.getByRole('checkbox', { name: /显示探针补充的方法/ }));
  fireEvent.click(ui.getByRole('button', { name: '清除过滤' }));
  expect(edge(extra.id, leaf.id)).toHaveAttribute('data-state', 'running');
  fireEvent.click(ui.getByRole('button', { name: /定位 Version\.parse/ }));
  expect(ui.getByRole('region', { name: '方法详情' })).toHaveTextContent('demo');
});

it('locates a shared descendant through consecutive group and manual exclusions without clearing either filter', () => {
  const first = method('parseInput', true),
    second = method('normalize', true);
  const dispatch = method('dispatch'),
    audit = method('audit'),
    db = method('readDatabase', false);
  const nodes = [root, first, dispatch, second, db, sibling, audit];
  const chain = [root, first, dispatch, second, db];
  const branched: MethodGraph = {
    nodes,
    roots: [root.id, sibling.id],
    warnings: [],
    edges: [
      ...chain.slice(1).map((node, i) => ({ from: chain[i].id, to: node.id })),
      { from: sibling.id, to: second.id },
      { from: dispatch.id, to: first.id },
      { from: sibling.id, to: audit.id },
    ],
  };
  const recording = applyEvents(emptyRecording(), [
    { seq: 1, type: 'request', requestId: 'r', method: 'GET', path: '/version', startedAt: 1 },
    ...chain.map((node, i) => ({
      seq: 2 + i,
      type: 'enter' as const,
      requestId: 'r',
      callId: String(i),
      parentId: i ? String(i - 1) : null,
      node,
      args: [node.id],
    })),
  ]);
  const ui = render(
    <ApiMethodDiagram
      graph={branched}
      route={route}
      request={recording.requests.get('r')}
      interrupted={false}
    />,
  );
  fireEvent.click(ui.getByRole('button', { name: '过滤方法（2）' }));
  expect(ui.getByRole('switch', { name: '过滤静态方法' })).toBeChecked();
  fireEvent.click(ui.getByRole('checkbox', { name: /隐藏 dispatch/ }));
  fireEvent.click(ui.getByRole('checkbox', { name: /隐藏 audit/ }));
  expect(ui.getByRole('button', { name: '过滤方法（4）' })).toBeVisible();
  expect(ui.getByRole('button', { name: /定位 dispatch/ })).toBeDisabled();
  const edge = (from: string) =>
    ui.container.querySelector(`[data-from="${from}"][data-to="readDatabase"]`);
  expect(edge(root.id)).toHaveAttribute('data-state', 'running');
  expect(edge(sibling.id)).toHaveAttribute('data-state', 'idle');
  fireEvent.click(ui.getByRole('button', { name: '收起 handle 的下游方法' }));
  fireEvent.click(ui.getByRole('button', { name: '收起 findVersion 的下游方法' }));
  expect(ui.queryByRole('button', { name: 'readDatabase，执行中' })).toBeNull();
  fireEvent.change(ui.getByRole('searchbox'), { target: { value: 'readDatabase' } });
  fireEvent.click(ui.getByRole('button', { name: /定位 readDatabase/ }));
  expect(ui.getByRole('region', { name: '方法详情' })).toHaveTextContent('"readDatabase"');
  expect(ui.getByRole('button', { name: '过滤方法（4）' })).toBeVisible();
  expect(
    ui.getAllByRole('button', { name: /^展开 (handle|findVersion) 的下游方法$/ }),
  ).toHaveLength(1);
});

it.each([false, true])(
  'shows the live BullMQ child branch after HTTP ends (static branch %s)',
  (staticBranch) => {
    const queue = { ...method('enqueue'), name: 'BullMQ 入队', kind: 'queue' } as const;
    const worker = { ...method('worker'), name: 'BullMQ Worker', kind: 'worker' } as const;
    const task = method('processTask');
    const callback = { ...method('processorCallback'), anonymous: true };
    const workerGraph = staticBranch
      ? {
          ...graph,
          nodes: [...graph.nodes, queue, worker, callback, task],
          edges: [
            ...graph.edges,
            { from: root.id, to: queue.id },
            { from: queue.id, to: worker.id },
            { from: worker.id, to: callback.id },
            { from: callback.id, to: task.id },
          ],
        }
      : graph;
    const ui = render(<ApiMethodDiagram route={route} graph={workerGraph} interrupted={false} />);
    const edge = (from: string, to: string) =>
      ui.container.querySelector(`[data-from="${from}"][data-to="${to}"]`);
    const idle = staticBranch ? 'idle' : undefined;
    expect(edge(root.id, queue.id)?.getAttribute('data-state')).toBe(idle);
    expect(edge(queue.id, worker.id)?.getAttribute('data-state')).toBe(idle);
    expect(edge(worker.id, task.id)?.getAttribute('data-state')).toBe(idle);
    expect(ui.queryByRole('button', { name: /^processorCallback，/ })).toBeNull();
    const traced = applyEvents(emptyRecording(), [
      { seq: 1, type: 'request', requestId: 'req', method: 'GET', path: '/version', startedAt: 1 },
      {
        seq: 2,
        type: 'enter',
        requestId: 'req',
        callId: 'r',
        parentId: null,
        node: root,
        args: [],
      },
      {
        seq: 3,
        type: 'enter',
        requestId: 'req',
        callId: 'q',
        parentId: 'r',
        node: queue,
        args: [],
      },
      {
        seq: 4,
        type: 'leave',
        requestId: 'req',
        callId: 'q',
        durationMs: 3,
        result: {},
        state: 'ok',
      },
      { seq: 5, type: 'end', requestId: 'req', status: 200, durationMs: 5, dropped: 0 },
      {
        seq: 6,
        type: 'enter',
        requestId: 'req',
        callId: 'w',
        parentId: 'q',
        queueAnchor: 'q',
        node: worker,
        args: [],
      },
      {
        seq: 7,
        type: 'enter',
        requestId: 'req',
        callId: 't',
        parentId: 'w',
        queueAnchor: 'q',
        node: task,
        args: [],
      },
    ]);
    ui.rerender(
      <ApiMethodDiagram
        route={route}
        graph={workerGraph}
        request={traced.requests.get('req')}
        interrupted={false}
      />,
    );
    expect(ui.getAllByRole('button', { name: /^BullMQ Worker，/ })).toHaveLength(1);
    expect(edge(queue.id, worker.id)).toHaveAttribute('data-state', 'running');
    expect(edge(worker.id, task.id)).toHaveAttribute('data-state', 'running');
    expect(ui.queryByRole('checkbox', { name: /显示探针补充的方法/ })).toBeNull();
    const finished = applyEvents(traced, [
      {
        seq: 8,
        type: 'leave',
        requestId: 'req',
        callId: 't',
        durationMs: 8,
        result: 6,
        state: 'ok',
      },
      {
        seq: 9,
        type: 'leave',
        requestId: 'req',
        callId: 'w',
        durationMs: 9,
        result: 6,
        state: 'ok',
      },
    ]);
    ui.rerender(
      <ApiMethodDiagram
        route={route}
        graph={workerGraph}
        request={finished.requests.get('req')}
        interrupted={false}
      />,
    );
    expect(edge(queue.id, worker.id)).toHaveAttribute('data-state', 'completed');
    fireEvent.click(ui.getByRole('button', { name: 'BullMQ Worker，已返回' }));
    expect(ui.getByRole('region', { name: '方法详情' })).toHaveTextContent('9 ms');
  },
);

it('按当前请求组合过滤未执行方法和耗时，保留边界值及执行中的调用', () => {
  const start = {
    seq: 1,
    type: 'request' as const,
    requestId: 'r',
    method: 'GET',
    path: '/version',
    startedAt: 0,
  };
  const enter = (seq: number, node: MethodNode) => ({
    seq,
    type: 'enter' as const,
    requestId: 'r',
    callId: String(seq),
    parentId: null,
    node,
    args: [],
  });
  const leave = (seq: number, id: number, durationMs: number) => ({
    seq,
    type: 'leave' as const,
    requestId: 'r',
    callId: String(id),
    state: 'ok' as const,
    result: null,
    durationMs,
  });
  const request = applyEvents(emptyRecording(), [
    start,
    enter(2, root),
    leave(3, 2, 250),
    enter(4, root),
    leave(5, 4, 10),
    enter(6, sibling),
    leave(7, 6, 249),
    enter(8, helper),
  ]).requests.get('r');
  const diagram = (req = request) => (
    <ApiMethodDiagram route={route} graph={graph} request={req} interrupted={false} />
  );
  const ui = render(diagram());
  fireEvent.click(ui.getByRole('button', { name: /过滤方法/ }));
  fireEvent.click(ui.getByRole('switch', { name: '过滤静态方法' }));
  const duration = ui.getByRole('spinbutton', { name: '最短执行时间（秒）' });
  const hidden = (node: MethodNode) =>
    ui.getByRole('checkbox', { name: new RegExp('隐藏 ' + node.name) });
  fireEvent.change(duration, { target: { value: '0.25' } });
  expect(hidden(root)).not.toBeChecked();
  expect(hidden(sibling)).toBeChecked();
  expect(hidden(helper)).not.toBeChecked();
  expect(hidden(leaf)).not.toBeChecked();
  fireEvent.click(ui.getByRole('switch', { name: '过滤未执行方法' }));
  expect(hidden(leaf)).toBeChecked();
  ui.rerender(
    diagram(
      applyEvents(emptyRecording(), [{ ...start, requestId: 'other' }]).requests.get('other'),
    ),
  );
  expect(hidden(root)).toBeChecked();
  fireEvent.click(ui.getByRole('button', { name: '清除过滤' }));
  expect(duration).toHaveValue(null);
  expect(hidden(root)).not.toBeChecked();
});

it('点击投影连线只高亮当前两端，切换连线或按 Escape 时更新高亮', () => {
  const ui = render(<ApiMethodDiagram route={route} graph={graph} interrupted={false} />);
  const endpoints = () =>
    Array.from(ui.container.querySelectorAll('[data-endpoint]'), (node) =>
      node.getAttribute('aria-label'),
    );
  const edge = (name: string) => ui.getByRole('button', { name: '调用连线：' + name });
  fireEvent.click(edge('handle → compareVersion'));
  expect(endpoints().sort()).toEqual(['compareVersion，待采集', 'handle，待采集']);
  const second = edge('findVersion → compareVersion');
  fireEvent.keyDown(second, { key: 'Enter' });
  expect(endpoints().sort()).toEqual(['compareVersion，待采集', 'findVersion，待采集']);
  fireEvent.keyDown(second, { key: 'Escape' });
  expect(endpoints()).toEqual([]);
});
