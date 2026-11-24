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
  fireEvent.click(ui.getByRole('button', { name: '过滤方法' }));
  const mode = ui.getByRole('switch', { name: '过滤静态方法' });
  const manual = ui.getByRole('checkbox', { name: /隐藏 Version\.fromString/ });
  const locate = ui.getByRole('button', { name: /定位 Version\.fromString/ });
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
  expect(edge(extra.id, leaf.id)).toHaveAttribute('data-state', 'running');
  fireEvent.click(ui.getByRole('button', { name: '过滤方法' }));
  fireEvent.click(ui.getByRole('switch', { name: '过滤静态方法' }));
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
  fireEvent.click(ui.getByRole('button', { name: '过滤方法' }));
  fireEvent.click(ui.getByRole('switch', { name: '过滤静态方法' }));
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
