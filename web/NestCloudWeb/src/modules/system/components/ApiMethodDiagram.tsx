import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MethodGraph, MethodNode, ProjectRoute } from '../api/apiCallGraph';
import {
  MAX_TRACE_ZOOM,
  MIN_TRACE_ZOOM,
  useTraceDiagramCamera,
} from '../hooks/useTraceDiagramCamera';
import {
  describeCalls,
  edgeKey,
  formatDuration,
  layoutMethods,
  type Invocation,
  type RecordedRequest,
  type Recording,
} from '../utils/apiCallTrace';
import trace from './TraceLogResults.module.css';
import styles from './ApiMethodDiagram.module.css';
import canvas from './ApiMethodCanvas.module.css';
import { isAnonymousMethod, projectMethodGraph } from '../utils/apiCallProjection';
import { buildCallBranches, expandPathToMethod, httpEntryId } from '../utils/apiCallBranches';
import { prepareCallConnectors } from '../utils/apiCallConnector';

const entry: MethodNode = { id: httpEntryId, name: 'HTTP 入口', file: '', line: 0 };
type Topology = Pick<MethodGraph, 'roots' | 'nodes' | 'edges'>;

function sameTopology(a: Topology, b: Topology) {
  return (
    a === b ||
    (a.nodes.length === b.nodes.length &&
      a.edges.length === b.edges.length &&
      a.roots.length === b.roots.length &&
      a.nodes.every(
        (n, i) =>
          n === b.nodes[i] ||
          (n.id === b.nodes[i].id &&
            n.name === b.nodes[i].name &&
            n.file === b.nodes[i].file &&
            n.line === b.nodes[i].line),
      ) &&
      a.edges.every((e, i) => e.from === b.edges[i].from && e.to === b.edges[i].to) &&
      a.roots.every((id, i) => id === b.roots[i]))
  );
}
const stateLabels = {
  running: '执行中',
  completed: '已返回',
  error: '异常',
  incomplete: '未完成',
} as const;

type Position =
  ReturnType<typeof layoutMethods>['positions'] extends Map<string, infer P> ? P : never;

function nodeLabel(name: string) {
  // Keep the method visible when its class qualifier is longer than the card.
  if (name.length <= 26) return name;
  const unqualified = name.split('.').at(-1) || name;
  return unqualified.length > 26 ? unqualified.slice(0, 25) + '…' : unqualified;
}
function compactConnector(from: Position, to: Position, layout: ReturnType<typeof layoutMethods>) {
  const { cardWidth, cardHeight } = layout;
  const startX = from.x + cardWidth / 2;
  const startY = from.y + cardHeight;
  const endX = to.x + cardWidth / 2;
  const midY = startY + layout.rowGap / 2;
  if (to.y === startY + layout.rowGap) {
    return `M ${startX} ${startY} V ${midY} H ${endX} V ${to.y - 4}`;
  }
  if (from.y === to.y && from.x !== to.x) {
    const rightward = from.x < to.x;
    return `M ${rightward ? from.x + cardWidth : from.x} ${from.y + cardHeight / 2} H ${rightward ? to.x - 4 : to.x + cardWidth + 4}`;
  }
  // Long connections follow the margin around wrapped rows. Enter on the
  // outside of the destination so the other card in its row stays clear.
  const left = endX < layout.width / 2 || (endX === layout.width / 2 && startX <= endX);
  const portX = left ? to.x - 4 : to.x + cardWidth + 4;
  const rowDistance = Math.round(Math.abs(to.y - from.y) / (cardHeight + layout.rowGap));
  const inset = 4 + (rowDistance % 3) * 3;
  const laneX = left ? inset : layout.width - inset;
  return `M ${startX} ${startY} V ${midY} H ${laneX} V ${to.y + cardHeight / 2} H ${portX}`;
}

export function ApiMethodDiagram({
  route,
  graph,
  request,
  interrupted,
  liveReturns,
}: {
  route?: Pick<ProjectRoute, 'id' | 'method' | 'path'>;
  graph: MethodGraph;
  request?: RecordedRequest;
  interrupted: boolean;
  liveReturns?: Recording['liveReturns'];
}) {
  const world = useRef<SVGGElement>(null);
  const consumedReturns = useRef(liveReturns);
  const [selectedId, select] = useState<string>();
  const [showExtras, setShowExtras] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [hideStatic, setHideStatic] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingLocate, setPendingLocate] = useState<string>();
  const stage = useRef<HTMLDivElement>(null);
  const [compactWidth, setCompactWidth] = useState<number>();
  useLayoutEffect(() => {
    const area = stage.current;
    if (!area) return;
    function measure() {
      const width = area!.clientWidth;
      setCompactWidth(width > 0 && width <= 600 ? width : undefined);
    }
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(area);
    return () => resize.disconnect();
  }, []);
  const baseIds = useMemo(() => new Set(graph.nodes.map((node) => node.id)), [graph]);
  const named = useMemo(() => graph.nodes.filter((node) => !isAnonymousMethod(node)), [graph]);
  const extraNodes = useMemo(() => {
    const extra = new Map<string, MethodNode>();
    for (const { node } of request?.calls.values() ?? []) {
      if (!baseIds.has(node.id) && !isAnonymousMethod(node)) extra.set(node.id, node);
    }
    return [...extra.values()];
  }, [request, baseIds]);
  const extraVisible = showExtras || named.length === 0;
  const candidates = useMemo(
    () => (extraVisible ? [...named, ...extraNodes] : named),
    [extraVisible, named, extraNodes],
  );
  const isVisible = useCallback(
    (node: MethodNode) => !excluded.has(node.id) && !(hideStatic && node.computationOnly === true),
    [excluded, hideStatic],
  );
  const visibleIds = useMemo(
    () => new Set(candidates.filter(isVisible).map((node) => node.id)),
    [candidates, isVisible],
  );
  const filteredCount = candidates.length - visibleIds.size;
  const staticGraph = useMemo(
    () => projectMethodGraph(graph, new Set(named.filter(isVisible).map((node) => node.id))),
    [graph, named, isVisible],
  );
  const observed = useMemo(
    () => describeCalls(graph, request, visibleIds, interrupted),
    [graph, request, visibleIds, interrupted],
  );
  const proposed = useMemo(() => {
    const edges = new Map(staticGraph.edges.map((edge) => [edgeKey(edge), edge]));
    for (const [key, edge] of observed.observedEdges) if (!edges.has(key)) edges.set(key, edge);
    const roots = new Set([...staticGraph.roots, ...observed.entryStates.keys()]);
    const additional = extraVisible ? extraNodes.filter((node) => visibleIds.has(node.id)) : [];
    if (
      !additional.length &&
      edges.size === staticGraph.edges.length &&
      roots.size === staticGraph.roots.length
    )
      return staticGraph;
    return {
      edges: [...edges.values()],
      roots: [...roots],
      nodes: [...staticGraph.nodes, ...additional],
    };
  }, [observed, staticGraph, extraVisible, extraNodes, visibleIds]);
  // Arguments, timing and repeated invocations frequently arrive with identical topology.
  const previous = useRef<Topology>(proposed);
  const structure = sameTopology(previous.current, proposed) ? previous.current : proposed;
  useLayoutEffect(() => {
    previous.current = structure;
  }, [structure]);
  const branches = useMemo(
    () => buildCallBranches(structure, entry, collapsed),
    [structure, collapsed],
  );
  const staticKeys = useMemo(
    () => new Set(buildCallBranches(staticGraph, entry, new Set()).edges.map(edgeKey)),
    [staticGraph],
  );
  const layout = useMemo(() => {
    // A newly observed shortcut does not change a method's static level. Use
    // actual callers for methods with no remaining static parent after folding.
    const preferred = branches.edges.filter((edge) => staticKeys.has(edgeKey(edge)));
    const placed = new Set(preferred.map((edge) => edge.to));
    const connections = [...preferred, ...branches.edges.filter((edge) => !placed.has(edge.to))];
    if (route) return layoutMethods(branches.nodes, connections, branches.roots, compactWidth);
    const roots = connections.filter((edge) => edge.from === httpEntryId).map((edge) => edge.to);
    return layoutMethods(
      branches.nodes.filter((node) => node.id !== httpEntryId),
      connections.filter((edge) => edge.from !== httpEntryId),
      roots,
      compactWidth,
    );
  }, [branches, staticKeys, route, compactWidth]);
  const { cardWidth, cardHeight, compact } = layout;
  const routeConnector = useMemo(
    () =>
      compact && !('groups' in layout)
        ? undefined
        : prepareCallConnectors(layout.positions, cardWidth, cardHeight),
    [layout, cardWidth, cardHeight, compact],
  );
  const textInset = compact ? 9 : 12;
  const edges = branches.edges;
  const first = layout.positions.values().next().value;
  const camera = useTraceDiagramCamera(layout, {
    x: (first?.x ?? 0) + cardWidth / 2,
    y: (first?.y ?? 0) + cardHeight / 2,
  });
  const { x, y, zoom } = camera.camera;
  const definition = useId();
  const selected = selectedId ? layout.positions.get(selectedId)?.node : undefined;
  const finished = interrupted || Boolean(request?.end);
  const entryState = !request
    ? 'idle'
    : request.end
      ? request.end.status >= 400
        ? 'error'
        : 'completed'
      : interrupted
        ? 'incomplete'
        : 'running';
  const entryStatus = entryState === 'idle' ? '待采集' : stateLabels[entryState];
  useLayoutEffect(() => {
    if (!liveReturns || consumedReturns.current === liveReturns) return;
    consumedReturns.current = liveReturns;
    const duration = 650;
    if (
      performance.now() - liveReturns.receivedAt >= duration ||
      document.hidden ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return;
    for (const path of world.current?.querySelectorAll<SVGPathElement>('[data-return-seq]') ?? []) {
      if (!liveReturns.sequences.has(Number(path.dataset.returnSeq))) continue;
      // This plays once on the committed graph for the new arrival batch. Re-layouts
      // and selecting a historical request do not schedule an animation.
      for (const active of path.getAnimations?.() ?? []) active.cancel();
      path.animate?.(
        [
          { strokeDashoffset: '12', opacity: 0 },
          { strokeDashoffset: '0', opacity: 1, offset: 0.1 },
          { strokeDashoffset: '-86', opacity: 1, offset: 0.88 },
          { strokeDashoffset: '-100', opacity: 0 },
        ],
        { duration, easing: 'linear' },
      );
    }
  }, [liveReturns]);
  function toggleMethod(id: string) {
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleBranch(id: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function locateMethod(id: string) {
    if (!layout.positions.has(id)) {
      const full = buildCallBranches(structure, entry, new Set());
      setCollapsed(expandPathToMethod(full, collapsed, id));
    }
    setPendingLocate(id);
    setFilterOpen(false);
  }
  useLayoutEffect(() => {
    if (!pendingLocate) return;
    const position = layout.positions.get(pendingLocate);
    if (position) {
      camera.centerOn(position.x + cardWidth / 2, position.y + cardHeight / 2);
      select(pendingLocate);
      camera.viewport.current?.focus({ preventScroll: true });
    }
    setPendingLocate(undefined);
  }, [pendingLocate, layout, camera, cardWidth, cardHeight]);
  function closeFilter() {
    setFilterOpen(false);
    filterButton.current?.focus({ preventScroll: true });
  }
  function closeDetails() {
    select(undefined);
    camera.viewport.current?.focus({ preventScroll: true });
  }

  return (
    <section
      className={trace.diagram + ' ' + canvas.canvas}
      aria-label="接口方法调用关系"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || (!filterOpen && !selected)) return;
        event.stopPropagation();
        if (filterOpen) closeFilter();
        else closeDetails();
      }}
    >
      <div className={trace.tools + ' ' + canvas.toolbar}>
        <button
          type="button"
          aria-label="缩小"
          disabled={zoom <= MIN_TRACE_ZOOM}
          onClick={() => camera.zoomFromCenter(zoom / 1.25)}
        >
          −
        </button>
        <output aria-label="缩放比例">{Math.round(zoom * 100)}%</output>
        <button
          type="button"
          aria-label="放大"
          disabled={zoom >= MAX_TRACE_ZOOM}
          onClick={() => camera.zoomFromCenter(Math.max(MIN_TRACE_ZOOM, zoom * 1.25))}
        >
          +
        </button>
        <button type="button" onClick={camera.fit}>
          适应窗口
        </button>
        <button
          type="button"
          ref={filterButton}
          aria-expanded={filterOpen}
          aria-controls={definition + '-filters'}
          onClick={() => setFilterOpen(!filterOpen)}
        >
          过滤方法{hideStatic || excluded.size ? '（' + filteredCount + '）' : ''}
        </button>
        {collapsed.size > 0 && (
          <>
            <span className={canvas.hiddenCount}>
              已收起 {collapsed.size} 处分支 · 隐藏 {branches.hiddenCount} 个方法
            </span>
            <button type="button" onClick={() => setCollapsed(new Set())}>
              展开全部
            </button>
          </>
        )}
        {extraNodes.length > 0 && named.length > 0 && (
          <label className={styles.extra}>
            <input
              type="checkbox"
              checked={showExtras}
              onChange={(event) => setShowExtras(event.target.checked)}
            />
            显示探针补充的方法（{extraNodes.length}）
          </label>
        )}
      </div>
      <div className={canvas.stage} ref={stage}>
        <div
          ref={camera.viewport}
          className={trace.viewport + ' ' + canvas.viewport}
          tabIndex={0}
          aria-label="流程图视图"
          onPointerDown={camera.pointerDown}
          onPointerMove={camera.pointerMove}
          onPointerUp={camera.pointerEnd}
          onPointerCancel={camera.pointerEnd}
          onLostPointerCapture={(event) => {
            if (event.target === event.currentTarget) camera.pointerEnd(event);
          }}
          onPointerLeave={(event) => {
            if (!camera.dragging.current) camera.pointerEnd(event);
          }}
          onClickCapture={(event) => {
            if (event.detail > 0 && camera.suppressClick.current) event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const moves: Record<string, [number, number]> = {
              ArrowUp: [0, 36],
              ArrowDown: [0, -36],
              ArrowLeft: [36, 0],
              ArrowRight: [-36, 0],
            };
            if (moves[event.key]) {
              event.preventDefault();
              camera.panBy(...moves[event.key]);
            }
          }}
        >
          {!structure.nodes.length && (
            <p className={route ? canvas.empty : styles.empty}>
              {filteredCount > 0
                ? '当前方法已全部过滤，可在「过滤方法」中恢复。'
                : '未找到可展示的具名方法。调用接口后，可查看探针采集到的具名方法。'}
            </p>
          )}
          <svg className={trace.flowchart} width="100%" height="100%" aria-label="方法调用流程图">
            <defs>
              <pattern
                id={definition}
                width="20"
                height="20"
                patternUnits="userSpaceOnUse"
                patternTransform={`translate(${x} ${y}) scale(${zoom})`}
              >
                <circle className={trace.gridDot} cx="1" cy="1" r="1" />
              </pattern>
              {['idle', 'running', 'completed', 'error', 'incomplete'].map((state) => (
                <marker
                  key={state}
                  id={definition + state}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto"
                >
                  <path d="M0 0 L8 4 L0 8Z" className={styles.arrow} data-state={state} />
                </marker>
              ))}
            </defs>
            <rect width="100%" height="100%" fill={'url(#' + definition + ')'} />
            <g ref={world} transform={`translate(${x} ${y}) scale(${zoom})`}>
              {'groups' in layout &&
                layout.groups.map((group) => (
                  <g key={group.owner.id} className={styles.family}>
                    <rect
                      x={group.x}
                      y={group.y}
                      width={group.width}
                      height={group.height}
                      rx={36}
                    />
                    <svg x={group.x + 16} y={group.y + 5} width={group.width - 32} height={22}>
                      <text y={15}>
                        {group.owner.name} · {group.count} 个下游方法
                      </text>
                    </svg>
                  </g>
                ))}
              {edges.map((edge) => {
                const from = layout.positions.get(edge.from),
                  to = layout.positions.get(edge.to);
                if (!from || !to) return null;
                const key = edgeKey(edge);
                const activity =
                  edge.from === httpEntryId
                    ? observed.entryStates.get(edge.to)
                    : observed.edgeStates.get(key);
                const state = activity?.state ?? 'idle';
                const path = routeConnector
                  ? routeConnector(edge.from, edge.to)
                  : compactConnector(from, to, layout);
                return (
                  <g
                    key={key}
                    className={styles.connection}
                    data-state={state}
                    data-branch={
                      'owners' in layout
                        ? edge.from === httpEntryId
                          ? 'entry'
                          : layout.owners.get(edge.to) === edge.from
                            ? 'primary'
                            : 'shared'
                        : undefined
                    }
                    data-from={edge.from}
                    data-to={edge.to}
                    aria-hidden="true"
                  >
                    <path
                      d={path}
                      className={styles.edge}
                      markerEnd={'url(#' + definition + state + ')'}
                    />
                    {activity?.lastSuccessSeq !== undefined && (
                      <path
                        key={request?.requestId}
                        className={styles.returnPulse}
                        data-return-seq={activity.lastSuccessSeq}
                        pathLength={100}
                        d={path}
                      />
                    )}
                    {state === 'running' && (
                      <path d={path} pathLength={100} className={styles.edgePulse} />
                    )}
                  </g>
                );
              })}
              {[...layout.positions.values()].map(({ node, x: left, y: top }) => {
                const isEntry = node.id === httpEntryId && route !== undefined;
                const activity = observed.nodeStates.get(node.id);
                const state = isEntry ? entryState : (activity?.state ?? 'idle');
                const status = isEntry
                  ? entryStatus
                  : activity
                    ? stateLabels[activity.state]
                    : request
                      ? '未执行'
                      : '待采集';
                const name = isEntry ? 'HTTP 入口 · ' + route.method : node.name;
                const file = isEntry ? route.path : node.file.split('/').pop() + ':' + node.line;
                const last = activity?.lastExit;
                const metric = isEntry
                  ? request?.end && formatDuration(request.end.durationMs)
                  : last
                    ? formatDuration(last.durationMs)
                    : baseIds.has(node.id)
                      ? ''
                      : '动态';
                const hasChildren = Boolean(branches.childCounts.get(node.id));
                return (
                  <g key={node.id} transform={`translate(${left} ${top})`}>
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={(isEntry ? name + ' ' + route.path : name) + '，' + status}
                      aria-pressed={node.id === selectedId}
                      data-state={state}
                      data-entry={isEntry || undefined}
                      className={styles.method}
                      onClick={() => select(node.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          select(node.id);
                        }
                      }}
                    >
                      <title>
                        {isEntry
                          ? route.method + ' ' + route.path
                          : node.name + '\n' + node.file + ':' + node.line}
                      </title>
                      <rect className={styles.box} width={cardWidth} height={cardHeight} rx="7" />
                      {state === 'running' && (
                        <rect
                          className={styles.nodePulse}
                          width={cardWidth}
                          height={cardHeight}
                          rx="7"
                          pathLength={100}
                          aria-hidden="true"
                        />
                      )}
                      <svg
                        x={textInset}
                        width={cardWidth - 2 * textInset}
                        height={cardHeight}
                        overflow="hidden"
                      >
                        <svg
                          width={cardWidth - 2 * textInset - (hasChildren && !compact ? 30 : 0)}
                          height="30"
                          overflow="hidden"
                        >
                          <text className={trace.nodeName} y={compact ? 19 : 23}>
                            {nodeLabel(compact ? name.split('.').at(-1) || name : name)}
                          </text>
                        </svg>
                        <svg
                          width={cardWidth - 2 * textInset - (hasChildren && compact ? 28 : 0)}
                          height={cardHeight}
                          overflow="hidden"
                        >
                          <text className={trace.nodeAddress} y={compact ? 39 : 44}>
                            {file}
                          </text>
                        </svg>
                        <text className={styles.state} y={compact ? 57 : 67}>
                          {status}
                          {isEntry && request?.end && ' · HTTP ' + request.end.status}
                          {activity ? ' · ' + activity.count + ' 次' : ''}
                          {state === 'running' && activity?.errors
                            ? ' · ' + activity.errors + ' 次异常'
                            : ''}
                        </text>
                        <text
                          className={trace.metrics}
                          x={cardWidth - 2 * textInset}
                          y={compact ? 57 : 67}
                          textAnchor="end"
                        >
                          {metric}
                        </text>
                      </svg>
                    </g>
                    {hasChildren && (
                      <FoldButton
                        width={cardWidth}
                        compact={compact}
                        name={isEntry ? 'HTTP 入口' : name}
                        expanded={!collapsed.has(node.id)}
                        onClick={() => toggleBranch(node.id)}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        {filterOpen && (
          <MethodFilter
            id={definition + '-filters'}
            nodes={candidates}
            excluded={excluded}
            hideStatic={hideStatic}
            onHideStatic={setHideStatic}
            visibleIds={visibleIds}
            onToggle={toggleMethod}
            onLocate={locateMethod}
            onClear={() => {
              setExcluded(new Set());
              setHideStatic(false);
            }}
            onClose={closeFilter}
          />
        )}
        {selected?.id === httpEntryId && route && (
          <section aria-label="入口详情" className={canvas.detailsPanel}>
            <div className="d-flex align-items-start justify-content-between gap-3">
              <div>
                <h3 className="h6 mb-1">HTTP 入口</h3>
                <code className="text-break">
                  {route.method} {route.path}
                </code>
              </div>
              <button type="button" className={canvas.close} onClick={closeDetails}>
                关闭详情
              </button>
            </div>
            <p className={canvas.noCalls}>
              {entryStatus}
              {request?.end &&
                ' · HTTP ' + request.end.status + ' · ' + formatDuration(request.end.durationMs)}
            </p>
            {request && (
              <code className="text-break">
                {request.method} {request.path}
              </code>
            )}
          </section>
        )}
        {selected && selected.id !== httpEntryId && (
          <MethodDetails
            key={selected.id + ':' + (request?.requestId ?? '')}
            node={selected}
            calls={observed.byNode.get(selected.id) ?? []}
            finished={finished}
            onClose={closeDetails}
          />
        )}
      </div>
    </section>
  );
}

function FoldButton({
  width,
  compact,
  name,
  expanded,
  onClick,
}: {
  width: number;
  compact: boolean;
  name: string;
  expanded: boolean;
  onClick: () => void;
}) {
  const label = (expanded ? '收起 ' : '展开 ') + name + ' 的下游方法';
  return (
    <g
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={label}
      className={canvas.fold}
      transform={`translate(${width - 34} ${compact ? 23 : 5})`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <title>{label}</title>
      <rect width="28" height="24" rx="4" />
      <path d={expanded ? 'M9 10 L14 15 L19 10' : 'M12 7 L17 12 L12 17'} />
    </g>
  );
}

function MethodFilter({
  id,
  nodes,
  excluded,
  hideStatic,
  onHideStatic,
  visibleIds,
  onToggle,
  onLocate,
  onClear,
  onClose,
}: {
  id: string;
  nodes: MethodNode[];
  excluded: ReadonlySet<string>;
  hideStatic: boolean;
  onHideStatic: (value: boolean) => void;
  visibleIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onLocate: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const matches = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return nodes.filter(({ name, file, line }) => {
      const text = (name + ' ' + file + ':' + line).toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [nodes, search]);
  return (
    <section id={id} aria-label="过滤方法" className={styles.filter + ' ' + canvas.filterPanel}>
      <div className={styles.filterBar}>
        <input
          type="search"
          aria-label="搜索方法"
          placeholder="搜索方法名或源码位置"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" disabled={!excluded.size && !hideStatic} onClick={onClear}>
          清除过滤
        </button>
        <button type="button" aria-label="关闭方法过滤" onClick={onClose}>
          关闭
        </button>
      </div>
      <label className="form-check form-switch mt-2">
        <input
          className="form-check-input"
          type="checkbox"
          role="switch"
          checked={hideStatic}
          onChange={(event) => onHideStatic(event.target.checked)}
        />
        过滤静态方法
      </label>
      <p>隐藏仅做本地同步计算的方法。查库、接口请求、等待或无法判断的方法会保留。</p>
      <p>勾选列表可单独隐藏方法，匿名函数自动隐藏。</p>
      <div className={styles.filterList}>
        {matches.map((node) => (
          <div key={node.id} className={styles.filterRow}>
            <label>
              <input
                type="checkbox"
                checked={!visibleIds.has(node.id)}
                disabled={hideStatic && node.computationOnly === true}
                onChange={() => onToggle(node.id)}
                aria-label={'隐藏 ' + node.name + '（' + node.file + ':' + node.line + '）'}
              />
              <span>
                <strong>{node.name}</strong>
                <small>
                  {node.computationOnly === true &&
                    (hideStatic ? '已过滤本地计算 · ' : '本地同步计算 · ')}
                  {node.file}:{node.line}
                </small>
              </span>
            </label>
            <button
              type="button"
              aria-label={'定位 ' + node.name + '（' + node.file + ':' + node.line + '）'}
              disabled={!visibleIds.has(node.id)}
              onClick={() => onLocate(node.id)}
            >
              定位
            </button>
          </div>
        ))}
        {!matches.length && <p>没有匹配的具名方法。</p>}
      </div>
    </section>
  );
}

function MethodDetails({
  node,
  calls,
  finished,
  onClose,
}: {
  node: MethodNode;
  calls: Invocation[];
  finished: boolean;
  onClose: () => void;
}) {
  const [chosenIndex, setChosenIndex] = useState<number>();
  const index = chosenIndex ?? calls.length - 1;
  const call = calls[index];
  const pageSize = 100;
  const pageStart = Math.floor(index / pageSize) * pageSize;
  const pageEnd = Math.min(calls.length, pageStart + pageSize);
  const batch = calls.slice(pageStart, pageEnd);
  return (
    <section aria-label="方法详情" className={canvas.detailsPanel}>
      <div className="d-flex align-items-start justify-content-between gap-3">
        <div>
          <h3 className="h6 mb-1 text-break">{node.name}</h3>
          <code className="text-break">
            {node.file}:{node.line}
          </code>
        </div>
        <button type="button" className={canvas.close} onClick={onClose}>
          关闭详情
        </button>
      </div>
      {!call ? (
        <p className={canvas.noCalls}>当前没有该方法的调用记录。</p>
      ) : (
        <>
          <div className="d-flex flex-wrap gap-2 align-items-center mt-3">
            {calls.length > 1 && (
              <select
                aria-label="选择方法调用次数"
                className="form-select form-select-sm w-auto"
                value={chosenIndex === undefined ? '' : call.callId}
                onChange={(event) => {
                  const offset = batch.findIndex((item) => item.callId === event.target.value);
                  setChosenIndex(offset < 0 ? undefined : pageStart + offset);
                }}
              >
                <option value="">跟随最近一次</option>
                {batch.map((item, offset) => (
                  <option key={item.callId} value={item.callId}>
                    第 {pageStart + offset + 1} 次调用
                  </option>
                ))}
              </select>
            )}
            <span className="small">
              {call.exit
                ? (call.exit.state === 'error' ? '抛出异常' : '已返回') +
                  ' · ' +
                  formatDuration(call.exit.durationMs)
                : finished
                  ? '未记录返回'
                  : '执行中'}
            </span>
          </div>
          {calls.length > pageSize && (
            <div className={canvas.history}>
              <div>
                <button
                  type="button"
                  className={canvas.close}
                  disabled={pageStart === 0}
                  onClick={() => setChosenIndex(pageStart - pageSize)}
                >
                  上一页
                </button>
                <span>
                  {pageStart + 1}–{pageEnd} / {calls.length}
                </span>
                <button
                  type="button"
                  className={canvas.close}
                  disabled={pageEnd === calls.length}
                  onClick={() => setChosenIndex(pageEnd)}
                >
                  下一页
                </button>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const input = event.currentTarget.elements.namedItem(
                    'ordinal',
                  ) as HTMLInputElement;
                  const ordinal = input.valueAsNumber;
                  if (Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= calls.length)
                    setChosenIndex(ordinal - 1);
                }}
              >
                <label>
                  调用序号{' '}
                  <input
                    aria-label="调用序号"
                    type="number"
                    name="ordinal"
                    min={1}
                    max={calls.length}
                    step={1}
                    required
                  />
                </label>
                <button type="submit" className={canvas.close}>
                  跳转
                </button>
              </form>
            </div>
          )}
          <div className={trace.sections}>
            <div>
              <h4>入参</h4>
              <pre>{JSON.stringify(call.args, null, 2)}</pre>
            </div>
            <div>
              <h4>{call.exit?.state === 'error' ? '异常' : '出参'}</h4>
              <pre>
                {call.exit
                  ? (JSON.stringify(call.exit.result, null, 2) ?? 'undefined')
                  : finished
                    ? '未记录返回'
                    : '等待返回…'}
              </pre>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
