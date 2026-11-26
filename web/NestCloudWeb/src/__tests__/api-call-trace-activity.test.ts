import { describe, expect, it } from 'vitest';
import type { AgentEvent, MethodGraph } from '../modules/system/api/apiCallGraph';
import {
  applyEvents,
  describeCalls,
  edgeKey,
  emptyRecording,
  maxVisibleRequests,
} from '../modules/system/utils/apiCallTrace';

const node = (id: string) => ({ id, name: id, file: 'src/route.ts', line: 1 });
const graph: MethodGraph = {
  nodes: ['A', 'B', 'C'].map(node),
  roots: ['A', 'C'],
  warnings: [],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'C', to: 'B' },
    { from: 'A', to: 'C' },
  ],
};
const key = (from: string, to: string) => edgeKey({ from, to });

function eventsFor(requestId: string) {
  let seq = 0;
  return {
    start: (): AgentEvent => ({
      type: 'request',
      requestId,
      seq: ++seq,
      method: 'GET',
      path: '/',
      startedAt: 0,
    }),
    enter: (callId: string, parentId: string | null, method: string): AgentEvent => ({
      type: 'enter',
      seq: ++seq,
      requestId,
      callId,
      parentId,
      node: node(method),
      args: [],
    }),
    leave: (callId: string, state: 'ok' | 'error' = 'ok'): AgentEvent => ({
      type: 'leave',
      seq: ++seq,
      requestId,
      callId,
      state,
      durationMs: 1,
      result: 'value',
    }),
    end: (): AgentEvent => ({
      type: 'end',
      seq: ++seq,
      requestId,
      status: 200,
      durationMs: 2,
      dropped: 0,
    }),
  };
}

describe('真实调用状态投影', () => {
  it('单请求包含 300 个不同方法时，过滤后重复调用仍保留第 150 和第 301 两个序号', () => {
    const nodes = Array.from({ length: 300 }, (_, i) => node('method' + (i + 1)));
    const root = nodes[0].id;
    const repeated = nodes[149].id;
    const graph: MethodGraph = {
      nodes,
      roots: [root],
      edges: nodes.slice(1).map(({ id }) => ({ from: root, to: id })),
      warnings: [],
    };
    const e = eventsFor('large');
    const recording = applyEvents(emptyRecording(), [
      e.start(),
      ...nodes.map(({ id }, i) => e.enter(id, i ? root : null, id)),
      e.enter('again', root, repeated),
    ]);
    const request = recording.requests.get('large');
    const projected = describeCalls(graph, request, new Set([root, repeated]));
    expect(request?.calls.size).toBe(301);
    expect(projected.byNode.size).toBe(300);
    expect(projected.byNode.get(repeated)?.map((call) => call.requestOrder)).toEqual([150, 301]);
    expect([...projected.observedEdges.values()]).toEqual([{ from: root, to: repeated }]);
  });

  it('同一请求只为首次收到的进入事件编号，重复调用、乱序返回和重放保留原序号', () => {
    const e = eventsFor('r');
    const enters = [
      e.start(),
      e.enter('root', null, 'A'),
      e.enter('first-b', 'root', 'B'),
      e.enter('c', 'root', 'C'),
    ];
    const initial = applyEvents(emptyRecording(), enters);
    const recorded = applyEvents(initial, [
      ...enters,
      e.leave('c'),
      e.leave('first-b'),
      e.enter('worker:retry', 'root', 'B'),
    ]);
    const { byNode } = describeCalls(graph, recorded.requests.get('r'));
    expect(byNode.get('A')?.map((call) => call.requestOrder)).toEqual([1]);
    expect(byNode.get('B')?.map((call) => call.requestOrder)).toEqual([2, 4]);
    expect(byNode.get('C')?.map((call) => call.requestOrder)).toEqual([3]);
  });

  it('入口边按真实调用实例穿过无名及隐藏方法，保留缺失祖先与真实根的区别', () => {
    const e = eventsFor('r');
    const recording = applyEvents(emptyRecording(), [
      e.start(),
      e.enter('1', null, 'anonymous'),
      e.enter('2', '1', 'hidden'),
      e.enter('3', '2', 'B'),
      e.enter('4', '3', 'A'),
      e.leave('3'),
      e.enter('5', null, 'B'),
      e.leave('5', 'error'),
      e.enter('6', 'missing', 'anonymous'),
      e.enter('7', '6', 'C'),
    ]);
    const observed = describeCalls(graph, recording.requests.get('r'), new Set(['A', 'B', 'C']));
    expect([...observed.entryStates.keys()]).toEqual(['B']);
    expect(observed.entryStates.get('B')).toMatchObject({
      state: 'error',
      count: 2,
      completed: 1,
      errors: 1,
    });
    expect(observed.edgeStates.get(key('B', 'A'))).toMatchObject({ state: 'running' });
    expect(observed.nodeStates.has('C')).toBe(true);
  });
  it('折叠同名回调的不同实例，保留各自最近的可见祖先和递归边', () => {
    const e = eventsFor('r');
    const state = applyEvents(emptyRecording(), [
      e.start(),
      e.enter('1', null, 'A'),
      e.enter('2', '1', 'callback'),
      e.enter('3', null, 'C'),
      e.enter('4', '3', 'callback'),
      e.enter('5', '4', 'B'),
      e.leave('5'),
      e.enter('6', '2', 'B'),
      e.enter('7', '6', 'callback'),
      e.enter('8', '7', 'B'),
      // A gap in the replay must not connect this invocation to an unrelated root.
      e.enter('9', 'missing', 'C'),
    ]);
    const request = state.requests.get('r');
    const observed = describeCalls(graph, request, new Set(['A', 'B', 'C']));
    expect(observed.edgeStates.get(key('A', 'B'))).toMatchObject({ state: 'running', count: 1 });
    expect(observed.edgeStates.get(key('C', 'B'))).toMatchObject({ state: 'completed', count: 1 });
    expect(observed.edgeStates.get(key('B', 'B'))).toMatchObject({ state: 'running', count: 1 });
    expect(observed.observedEdges.has(key('A', 'C'))).toBe(false);
    expect(observed.observedEdges.size).toBe(3);
    // Expanding the callback restores its observed direct edges.
    const expanded = describeCalls(graph, request);
    expect(expanded.observedEdges.has(key('A', 'B'))).toBe(false);
    expect(expanded.edgeStates.get(key('callback', 'B'))).toMatchObject({
      count: 3,
      completed: 1,
      running: 2,
    });
  });

  it('分别累计并行、异常和未返回的实例，按实际退出顺序显示最近结果', () => {
    const e = eventsFor('r');
    const state = applyEvents(emptyRecording(), [
      e.start(),
      e.enter('1', null, 'A'),
      e.enter('2', '1', 'B'),
      e.enter('3', '1', 'B'),
      e.enter('4', '1', 'B'),
      e.leave('3'),
      e.leave('2', 'error'),
    ]);
    const request = state.requests.get('r');
    const live = describeCalls(graph, request);
    expect(live.nodeStates.get('B')).toMatchObject({
      state: 'running',
      count: 3,
      completed: 1,
      errors: 1,
      running: 1,
      incomplete: 0,
      lastExit: { callId: '2', state: 'error' },
    });
    expect(live.edgeStates.get(key('A', 'B'))).toEqual(live.nodeStates.get('B'));
    const ended = applyEvents(state, [e.end()]);
    for (const result of [
      describeCalls(graph, ended.requests.get('r')),
      describeCalls(graph, request, undefined, true),
    ]) {
      expect(result.nodeStates.get('A')).toMatchObject({
        state: 'incomplete',
        running: 0,
        incomplete: 1,
      });
      expect(result.edgeStates.get(key('A', 'B'))).toMatchObject({
        state: 'error',
        errors: 1,
        incomplete: 1,
      });
    }
  });

  it('短请求的进入和返回在同一批次仍保留完成状态，不同请求可复用 callId', () => {
    const slow = eventsFor('slow');
    let state = applyEvents(emptyRecording(), [slow.start(), slow.enter('1', null, 'A')]);
    for (let i = 0; i <= maxVisibleRequests; i++) {
      const e = eventsFor(String(i));
      state = applyEvents(state, [
        e.start(),
        e.enter('1', null, 'A'),
        e.enter('2', '1', 'B'),
        e.leave('2'),
        e.leave('1'),
        e.end(),
      ]);
    }
    expect(state.requests.size).toBe(maxVisibleRequests);
    expect(describeCalls(graph, state.requests.get('slow')).nodeStates.get('A')?.state).toBe(
      'running',
    );
    const last = describeCalls(graph, state.requests.get(String(maxVisibleRequests)));
    expect(last.nodeStates.get('A')?.state).toBe('completed');
    expect(last.edgeStates.get(key('A', 'B'))).toMatchObject({ state: 'completed', count: 1 });
    expect(last.nodeStates.has('C')).toBe(false);
  });
});
