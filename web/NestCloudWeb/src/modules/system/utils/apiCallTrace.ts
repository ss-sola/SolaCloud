import type { AgentEvent, MethodGraph, MethodNode } from '../api/apiCallGraph';
import { layoutCallBranches } from './apiCallBranchLayout';

export type Invocation = Extract<AgentEvent, { type: 'enter' }> & {
  exit?: Extract<AgentEvent, { type: 'leave' }>;
};
export type RecordedRequest = Extract<AgentEvent, { type: 'request' }> & {
  calls: Map<string, Invocation>;
  end?: Extract<AgentEvent, { type: 'end' }>;
};

export interface Recording {
  status?: Extract<AgentEvent, { type: 'status' }>;
  warnings?: ReadonlySet<string>;
  requests: Map<string, RecordedRequest>;
  liveReturns?: {
    sequences: ReadonlySet<number>;
    receivedAt: number;
    requestIds?: ReadonlySet<string>;
  };
}

export const maxVisibleRequests = 24;
export const maxProjectRequests = 96;
export const emptyRecording = (): Recording => ({ requests: new Map() });

// Copy each touched request once per batch, even when a whole recorded stream is replayed.
export function applyEvents(previous: Recording, events: AgentEvent[]): Recording {
  const next = { ...previous, requests: new Map(previous.requests) };
  const touched = new Set<string>();
  let warnings: Set<string> | undefined;
  for (const event of events) {
    if (event.type === 'warning') {
      if (!next.warnings?.has(event.message)) {
        warnings ??= new Set(next.warnings);
        warnings.add(event.message);
        next.warnings = warnings;
      }
      continue;
    }
    if (event.type === 'status') {
      next.status = event;
      continue;
    }
    if (event.type === 'request') {
      if (next.requests.has(event.requestId)) continue;
      next.requests.set(event.requestId, { ...event, calls: new Map() });
      touched.add(event.requestId);
      const all = [...next.requests.values()];
      const sameRoute = all.filter((item) => item.routeId === event.routeId);
      const overLimit =
        sameRoute.length > maxVisibleRequests
          ? sameRoute
          : all.length > maxProjectRequests
            ? all
            : undefined;
      // Retire a finished request first so slow parallel requests retain their open calls.
      if (overLimit)
        next.requests.delete((overLimit.find((item) => item.end) ?? overLimit[0]).requestId);
      continue;
    }
    let request = next.requests.get(event.requestId);
    if (!request) continue;
    if (!touched.has(event.requestId)) {
      request = { ...request, calls: new Map(request.calls) };
      next.requests.set(event.requestId, request);
      touched.add(event.requestId);
    }
    if (event.type === 'end') request.end = event;
    if (event.type === 'enter' && !request.calls.has(event.callId))
      request.calls.set(event.callId, event);
    if (event.type === 'leave') {
      const call = request.calls.get(event.callId);
      if (call) request.calls.set(call.callId, { ...call, exit: event });
    }
  }
  return next;
}

export interface Activity {
  state: 'running' | 'completed' | 'error' | 'incomplete';
  count: number;
  running: number;
  completed: number;
  errors: number;
  incomplete: number;
  lastExit?: Invocation['exit'];
  lastSuccessSeq?: number;
}

function addInvocation(
  states: Map<string, Activity>,
  key: string,
  call: Invocation,
  finished: boolean,
) {
  let activity = states.get(key);
  if (!activity) {
    activity = { state: 'running', count: 0, running: 0, completed: 0, errors: 0, incomplete: 0 };
    states.set(key, activity);
  }
  activity.count++;
  if (call.exit) {
    if (!activity.lastExit || activity.lastExit.seq < call.exit.seq) activity.lastExit = call.exit;
    if (call.exit.state === 'error') activity.errors++;
    else {
      activity.completed++;
      activity.lastSuccessSeq = Math.max(activity.lastSuccessSeq ?? 0, call.exit.seq);
    }
  } else if (finished) {
    activity.incomplete++;
  } else {
    activity.running++;
  }
  if (activity.running) activity.state = 'running';
  else if (activity.errors) activity.state = 'error';
  else if (activity.incomplete) activity.state = 'incomplete';
  else activity.state = 'completed';
}

/** Project actual invocation instances onto the visible methods of a single request. */
export function describeCalls(
  graph: MethodGraph,
  request?: RecordedRequest,
  visibleIds?: ReadonlySet<string>,
  interrupted = false,
) {
  const byNode = new Map<string, Invocation[]>();
  const nodeStates = new Map<string, Activity>();
  const edgeStates = new Map<string, Activity>();
  const entryStates = new Map<string, Activity>();
  const observedEdges = new Map<string, { from: string; to: string }>();
  // null denotes a verified path to the request entry. undefined means ancestry
  // is missing from the stream and cannot be treated as an observed entry edge.
  const nearestVisible = new Map<string, string | null>();
  const extra = new Map<string, MethodNode>();
  const known = new Set(graph.nodes.map((node) => node.id));
  const finished = interrupted || Boolean(request?.end);
  for (const call of request?.calls.values() ?? []) {
    const list = byNode.get(call.node.id) ?? [];
    list.push(call);
    byNode.set(call.node.id, list);
    if (!known.has(call.node.id)) extra.set(call.node.id, call.node);
    addInvocation(nodeStates, call.node.id, call, finished);
    // Enter events are ordered parent-first by the probe. An absent parent interrupts
    // this chain; other invocations of the same method cannot supply its missing parent.
    const ancestor = call.parentId === null ? null : nearestVisible.get(call.parentId);
    if (visibleIds && !visibleIds.has(call.node.id)) {
      if (ancestor !== undefined) nearestVisible.set(call.callId, ancestor);
      continue;
    }
    nearestVisible.set(call.callId, call.node.id);
    if (ancestor === null) {
      addInvocation(entryStates, call.node.id, call, finished);
    } else if (ancestor !== undefined) {
      const edge = { from: ancestor, to: call.node.id };
      const key = edgeKey(edge);
      observedEdges.set(key, edge);
      addInvocation(edgeStates, key, call, finished);
    }
  }
  return { byNode, nodeStates, edgeStates, entryStates, observedEdges, extra };
}

export const edgeKey = (edge: { from: string; to: string }) => edge.from + '\0' + edge.to;
export const nodeWidth = 238;
export const nodeHeight = 82;

export function layoutMethods(
  nodes: MethodNode[],
  edges: MethodGraph['edges'],
  roots: string[],
  compactWidth?: number,
) {
  const children = new Map<string, string[]>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const { from, to } of edges) {
    const group = children.get(from) ?? [];
    group.push(to);
    children.set(from, group);
  }
  const layers: MethodNode[][] = [];
  const seen = new Set<string>();
  const append = (ids: Iterable<string>) => {
    let level = Array.from(new Set(ids)).filter((id) => byId.has(id) && !seen.has(id));
    while (level.length) {
      const row: MethodNode[] = [];
      for (const id of level) {
        seen.add(id);
        row.push(byId.get(id)!);
      }
      layers.push(row);
      level = Array.from(new Set(level.flatMap((id) => children.get(id) ?? []))).filter(
        (id) => !seen.has(id) && byId.has(id),
      );
    }
  };
  append(roots);
  for (const node of nodes) if (!seen.has(node.id)) append([node.id]);
  const breadth = Math.max(1, ...layers.map((row) => row.length));
  const depth = Math.max(1, layers.length);
  // Wide levels and branching multi-level graphs benefit from space on every
  // side of a caller. Small diagrams retain a single reading direction.
  if (breadth >= 6 || (nodes.length >= 12 && breadth >= 3)) {
    const compact = compactWidth !== undefined;
    return layoutCallBranches(layers, edges, {
      width: compact
        ? Math.min(180, Math.max(115, Math.floor((compactWidth - 46) / 2)))
        : nodeWidth,
      height: compact ? 68 : nodeHeight,
      compact,
    });
  }
  const positions = new Map<string, { node: MethodNode; x: number; y: number }>();
  if (compactWidth !== undefined) {
    const padding = 16;
    const columnGap = 14;
    const rowGap = 21;
    const columns = Math.min(breadth, compactWidth >= 275 ? 2 : 1);
    const cardWidth = Math.min(
      nodeWidth,
      Math.max(115, Math.floor((compactWidth - 2 * padding - (columns - 1) * columnGap) / columns)),
    );
    const cardHeight = 68;
    const width = columns * cardWidth + (columns - 1) * columnGap + 2 * padding;
    let row = 0;
    for (const layer of layers) {
      for (let offset = 0; offset < layer.length; offset += columns) {
        const count = Math.min(columns, layer.length - offset);
        const left = (width - count * cardWidth - (count - 1) * columnGap) / 2;
        for (let col = 0; col < count; col++) {
          const node = layer[offset + col];
          positions.set(node.id, {
            node,
            x: left + col * (cardWidth + columnGap),
            y: padding + row * (cardHeight + rowGap),
          });
        }
        row++;
      }
    }
    const height = Math.max(1, row) * (cardHeight + rowGap) - rowGap + 2 * padding;
    return {
      positions,
      width,
      height,
      cardWidth,
      cardHeight,
      rowGap,
      horizontal: false,
      compact: true,
    };
  }
  const padding = 24;
  const rowGap = 30;
  const columnGap = 28;
  const across = (count: number) => (nodeWidth + columnGap) * count - columnGap + 2 * padding;
  const down = (count: number) => (nodeHeight + rowGap) * count - rowGap + 2 * padding;
  // Many siblings fit more legibly in a column. Keep the usual top-down layout
  // for graphs where changing direction would save little space on a desktop.
  const verticalSpace = Math.max(across(breadth) / 1.8, down(depth));
  const horizontalSpace = Math.max(across(depth) / 1.8, down(breadth));
  const horizontal = horizontalSpace < verticalSpace * 0.9;
  const width = across(horizontal ? depth : breadth);
  const height = down(horizontal ? breadth : depth);
  layers.forEach((layer, level) => {
    const start = (breadth - layer.length) / 2;
    layer.forEach((node, index) => {
      const column = horizontal ? level : start + index;
      const row = horizontal ? start + index : level;
      positions.set(node.id, {
        node,
        x: padding + column * (nodeWidth + columnGap),
        y: padding + row * (nodeHeight + rowGap),
      });
    });
  });
  return {
    positions,
    width,
    height,
    horizontal,
    cardWidth: nodeWidth,
    cardHeight: nodeHeight,
    rowGap,
    compact: false,
  };
}

export function formatDuration(value: number) {
  if (value < 1) return value.toFixed(2) + ' ms';
  return Math.round(value * 10) / 10 + ' ms';
}
