import { act, fireEvent, render, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiMethodDiagram } from '../modules/system/components/ApiMethodDiagram';
import type { MethodGraph } from '../modules/system/api/apiCallGraph';
import { applyEvents, emptyRecording, layoutMethods } from '../modules/system/utils/apiCallTrace';

const route = { id: 'GET /version', method: 'GET', path: '/version' };
const method = (name: string) => ({ id: name, name, file: 'version.ts', line: 10 });
const graph: MethodGraph = {
  nodes: ['check', 'read', 'compare'].map(method),
  roots: ['check'],
  edges: [
    { from: 'check', to: 'read' },
    { from: 'read', to: 'compare' },
  ],
  warnings: [],
};

function measure(width: number, height: number) {
  let resize = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  return (nextWidth: number, nextHeight: number) => {
    width = nextWidth;
    height = nextHeight;
    act(() => resize());
  };
}

it('places filters and method details inside the same stage without consuming the gesture viewport', () => {
  measure(800, 360);
  const ui = render(<ApiMethodDiagram graph={graph} route={route} interrupted={false} />);
  const viewport = ui.getByLabelText('流程图视图');
  const stage = viewport.parentElement!;
  const zoom = ui.getByLabelText('缩放比例').textContent;
  fireEvent.click(ui.getByRole('button', { name: 'read，待采集' }));
  expect(ui.getByRole('region', { name: '方法详情' }).parentElement).toBe(stage);
  fireEvent.click(ui.getByRole('button', { name: '过滤方法' }));
  expect(ui.getByRole('region', { name: '过滤方法' }).parentElement).toBe(stage);
  expect(ui.getByLabelText('缩放比例')).toHaveTextContent(zoom!);
  fireEvent.keyDown(ui.getByRole('searchbox'), { key: 'Escape' });
  expect(ui.queryByRole('region', { name: '过滤方法' })).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: '关闭详情' }));
  expect(viewport).toHaveFocus();
  expect(ui.queryByRole('region', { name: '方法详情' })).toBeNull();
});

it('initially fits a typical graph and preserves the manual camera on viewport resize', () => {
  const resize = measure(800, 380);
  const ui = render(<ApiMethodDiagram graph={graph} route={route} interrupted={false} />);
  const zoom = ui.getByLabelText('缩放比例');
  const initial = Number.parseInt(zoom.textContent!);
  expect(initial).toBeGreaterThan(75);
  expect(initial).toBeLessThan(100);
  resize(1250, 890);
  expect(zoom).toHaveTextContent('100%');
  fireEvent.click(ui.getByRole('button', { name: '放大' }));
  resize(800, 380);
  expect(zoom).toHaveTextContent('125%');
  fireEvent.click(ui.getByRole('button', { name: '适应窗口' }));
  expect(zoom).toHaveTextContent(initial + '%');
  resize(1250, 890);
  expect(zoom).toHaveTextContent('100%');
});

it('spreads a wide family around its caller, opens readably, and supports fit-all', () => {
  measure(650, 400);
  const leaves = Array.from({ length: 20 }, (_, i) => method('result' + i));
  const wide = {
    ...graph,
    nodes: [method('check'), ...leaves],
    edges: leaves.map((n) => ({ from: 'check', to: n.id })),
  };
  const layout = layoutMethods(wide.nodes, wide.edges, wide.roots);
  const root = layout.positions.get('check')!;
  const siblings = leaves.map((leaf) => layout.positions.get(leaf.id)!);
  expect(siblings.some((n) => n.x < root.x)).toBe(true);
  expect(siblings.some((n) => n.x > root.x)).toBe(true);
  expect(siblings.some((n) => n.y < root.y)).toBe(true);
  expect(siblings.some((n) => n.y > root.y)).toBe(true);
  expect(new Set(siblings.map((n) => n.x + ',' + n.y)).size).toBe(leaves.length);
  const ui = render(<ApiMethodDiagram graph={wide} route={route} interrupted={false} />);
  expect(ui.getByLabelText('缩放比例')).toHaveTextContent('75%');
  fireEvent.click(ui.getByRole('button', { name: '适应窗口' }));
  expect(Number.parseInt(ui.getByLabelText('缩放比例').textContent!)).toBeLessThan(75);
  fireEvent.click(ui.getByRole('button', { name: '放大' }));
  expect(Number.parseInt(ui.getByLabelText('缩放比例').textContent!)).toBeGreaterThanOrEqual(25);
});

it('shows one HTTP entry even with no named methods and never invents method activity', () => {
  measure(800, 500);
  const ui = render(
    <ApiMethodDiagram
      graph={{ ...graph, nodes: [], edges: [], roots: [] }}
      route={route}
      interrupted={false}
    />,
  );
  expect(ui.getByRole('button', { name: /HTTP 入口 · GET \/version，待采集/ })).toBeVisible();
  expect(ui.getByText(/未找到可展示的具名方法/)).toBeVisible();
  const events = applyEvents(emptyRecording(), [
    { type: 'request', seq: 1, requestId: 'req', method: 'GET', path: '/version', startedAt: 1 },
    { type: 'end', seq: 2, requestId: 'req', status: 404, durationMs: 12.5, dropped: 0 },
  ]);
  ui.rerender(
    <ApiMethodDiagram
      graph={graph}
      route={route}
      interrupted={false}
      request={events.requests.get('req')}
    />,
  );
  const root = ui.getByRole('button', { name: /HTTP 入口 · GET \/version，异常/ });
  expect(root).toHaveTextContent('404');
  expect(root).toHaveTextContent('12.5 ms');
  expect(ui.container.querySelector('[data-from="http:entry"][data-to="check"]')).toHaveAttribute(
    'data-state',
    'idle',
  );
  fireEvent.click(root);
  expect(ui.getByRole('region', { name: '入口详情' })).toHaveTextContent('HTTP 404');
});

it('keeps each caller’s fan together in a named area and shared or recursive targets unique', () => {
  const entry = method('entry'),
    billing = method('billing'),
    reports = method('reports');
  const a = Array.from({ length: 15 }, (_, i) => method('total' + i));
  const b = Array.from({ length: 12 }, (_, i) => method('report' + i));
  const nodes = [entry, billing, reports, ...a, ...b];
  const edges = [
    { from: entry.id, to: billing.id },
    { from: entry.id, to: reports.id },
    ...a.map((n) => ({ from: billing.id, to: n.id })),
    ...b.map((n) => ({ from: reports.id, to: n.id })),
    { from: reports.id, to: a[0].id },
    { from: a[0].id, to: billing.id },
  ];
  for (const width of [undefined, 380]) {
    const layout = layoutMethods(nodes, edges, [entry.id], width);
    if (!('groups' in layout)) throw Error('expected separate caller groups');
    expect(layout.positions.size).toBe(nodes.length);
    expect(layout.groups.map((g) => g.owner.id)).toEqual([billing.id, reports.id]);
    for (const group of layout.groups) {
      const inside = [...layout.positions.values()].filter(
        (p) =>
          p.x < group.x + group.width &&
          p.x + layout.cardWidth > group.x &&
          p.y < group.y + group.height &&
          p.y + layout.cardHeight > group.y,
      );
      expect(inside.map((p) => p.node.id)).toEqual(
        (group.owner.id === billing.id ? a : b).map((m) => m.id),
      );
      expect(new Set(inside.map((p) => p.y)).size).toBeGreaterThan(4);
    }
    const positions = [...layout.positions.values()];
    const overlaps = positions.some((p, i) =>
      positions
        .slice(i + 1)
        .some(
          (q) => Math.abs(p.x - q.x) < layout.cardWidth && Math.abs(p.y - q.y) < layout.cardHeight,
        ),
    );
    expect(overlaps).toBe(false);
  }
});

it('fits the version-check topology at readable scale on a 390px phone and routes around wrapped cards', () => {
  measure(380, 655);
  const roots = ['validator', 'isTrusty', 'throwRequestError', 'checkVersion'];
  const methods = [...roots, 'isFalsy', 'queryLatestByAppType', 'compareVersion', 'debugSQL'];
  const api: MethodGraph = {
    nodes: methods.map(method),
    roots,
    warnings: [],
    edges: [
      { from: 'validator', to: 'isTrusty' },
      { from: 'validator', to: 'isFalsy' },
      { from: 'isTrusty', to: 'isFalsy' },
      { from: 'validator', to: 'throwRequestError' },
      { from: 'checkVersion', to: 'queryLatestByAppType' },
      { from: 'checkVersion', to: 'compareVersion' },
      { from: 'queryLatestByAppType', to: 'debugSQL' },
    ],
  };
  const ui = render(<ApiMethodDiagram graph={api} route={route} interrupted={false} />);
  expect(ui.getByLabelText('缩放比例')).toHaveTextContent('100%');
  const origin = (element: Element) =>
    element
      .getAttribute('transform')!
      .match(/[-\d.]+/g)!
      .map(Number);
  const buttons = Array.from(
    ui.container.querySelectorAll('g[role="button"][data-state]:has(> rect)'),
  );
  expect(buttons).toHaveLength(9);
  const [offsetX, offsetY] = origin(buttons[0].parentElement!.parentElement!);
  const cards = buttons.map((button) => {
    const [x, y] = origin(button.parentElement!);
    const card = button.querySelector('rect')!;
    const right = x + Number(card.getAttribute('width')),
      bottom = y + Number(card.getAttribute('height'));
    expect(x + offsetX).toBeGreaterThanOrEqual(0);
    expect(right + offsetX).toBeLessThanOrEqual(380);
    expect(y + offsetY).toBeGreaterThanOrEqual(0);
    expect(bottom + offsetY).toBeLessThanOrEqual(655);
    return { x, y, right, bottom };
  });
  for (const edge of ui.container.querySelectorAll('[data-from] > path:first-child')) {
    const commands = [...edge.getAttribute('d')!.matchAll(/([MVH]) ([-\d.]+)(?: ([-\d.]+))?/g)];
    expect(commands.length).toBeGreaterThan(1);
    let x = Number(commands[0][2]),
      y = Number(commands[0][3]);
    for (const [, cmd, value] of commands.slice(1)) {
      const next = Number(value);
      const cutsCard = cards.some((card) =>
        cmd === 'V'
          ? x > card.x &&
            x < card.right &&
            Math.max(y, next) > card.y &&
            Math.min(y, next) < card.bottom
          : y > card.y &&
            y < card.bottom &&
            Math.max(x, next) > card.x &&
            Math.min(x, next) < card.right,
      );
      expect(cutsCard).toBe(false);
      if (cmd === 'V') y = next;
      else x = next;
    }
  }
  const control = ui.getByRole('button', { name: '收起 checkVersion 的下游方法' });
  fireEvent.click(control);
  expect(ui.queryByRole('button', { name: 'compareVersion，待采集' })).toBeNull();
});

it('keeps collapsed branches stable through real events and makes hidden search results reachable', () => {
  measure(1024, 640);
  const ui = render(<ApiMethodDiagram graph={graph} route={route} interrupted={false} />);
  const fold = ui.getByRole('button', { name: '收起 check 的下游方法' });
  fireEvent.keyDown(fold, { key: 'Enter' });
  expect(ui.queryByRole('button', { name: 'read，待采集' })).toBeNull();
  expect(ui.queryByRole('region', { name: '方法详情' })).toBeNull();
  expect(ui.getByText(/隐藏 2 个方法/)).toBeVisible();
  const requests = applyEvents(emptyRecording(), [
    { seq: 1, type: 'request', requestId: 'req', method: 'GET', path: '/version', startedAt: 1 },
    {
      seq: 2,
      type: 'enter',
      requestId: 'req',
      callId: 'one',
      parentId: null,
      node: method('check'),
      args: [],
    },
    {
      seq: 3,
      type: 'enter',
      requestId: 'req',
      callId: 'two',
      parentId: 'one',
      node: method('read'),
      args: [],
    },
  ]);
  ui.rerender(
    <ApiMethodDiagram
      graph={graph}
      route={route}
      interrupted={false}
      request={requests.requests.get('req')}
    />,
  );
  expect(ui.getByRole('button', { name: '展开 check 的下游方法' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(ui.container.querySelector('[data-from="http:entry"][data-to="check"]')).toHaveAttribute(
    'data-state',
    'running',
  );
  expect(ui.container.querySelector('[data-from="check"][data-to="read"]')).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: '收起 HTTP 入口 的下游方法' }));
  expect(ui.getByText(/隐藏 3 个方法/)).toBeVisible();
  fireEvent.click(ui.getByRole('button', { name: '过滤方法' }));
  fireEvent.click(ui.getByRole('button', { name: /定位 read/ }));
  expect(ui.getByRole('region', { name: '方法详情' })).toHaveTextContent('read');
  expect(ui.queryByRole('region', { name: '过滤方法' })).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: '收起 HTTP 入口 的下游方法' }));
  fireEvent.click(ui.getByRole('button', { name: '展开全部' }));
  expect(ui.getByRole('button', { name: 'read，执行中' })).toBeVisible();
  expect(
    within(ui.getByLabelText('流程图视图')).getByRole('button', { name: 'compare，未执行' }),
  ).toBeVisible();
});

it('retains a shared method reached through an observed caller and folds that caller independently', () => {
  measure(1000, 600);
  const methods = {
    ...graph,
    nodes: ['A', 'B', 'C'].map(method),
    roots: ['A', 'B'],
    edges: [{ from: 'A', to: 'C' }],
  };
  const ui = render(<ApiMethodDiagram graph={methods} route={route} interrupted={false} />);
  const initial = ui
    .getByRole('button', { name: 'C，待采集' })
    .parentElement?.getAttribute('transform');
  const recording = applyEvents(emptyRecording(), [
    { type: 'request', seq: 1, requestId: 'req', method: 'GET', path: '/version', startedAt: 1 },
    {
      type: 'enter',
      seq: 2,
      requestId: 'req',
      callId: 'b',
      parentId: null,
      node: method('B'),
      args: [],
    },
    {
      type: 'enter',
      seq: 3,
      requestId: 'req',
      callId: 'c',
      parentId: 'b',
      node: method('C'),
      args: [],
    },
  ]);
  ui.rerender(
    <ApiMethodDiagram
      graph={methods}
      route={route}
      interrupted={false}
      request={recording.requests.get('req')}
    />,
  );
  expect(
    ui.getByRole('button', { name: 'C，执行中' }).parentElement?.getAttribute('transform'),
  ).toBe(initial);
  fireEvent.click(ui.getByRole('button', { name: '收起 A 的下游方法' }));
  expect(ui.getByRole('button', { name: 'C，执行中' })).toBeVisible();
  expect(ui.container.querySelector('[data-from="B"][data-to="C"]')).toHaveAttribute(
    'data-state',
    'running',
  );
  expect(ui.container.querySelector('[data-from="A"][data-to="C"]')).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: '收起 B 的下游方法' }));
  expect(ui.queryByRole('button', { name: 'C，执行中' })).toBeNull();
});
