import type { TraceLogEntry } from '../api/traceLogApi';

const sdkPrefix = /^\[[^\]]+\]\s+[A-Z]+\s+(?:\[traceId=[^\]]+\]\s+)?\[([^\]]+)\]\s*/;

export interface TraceHttpSection {
  state: 'captured' | 'truncated' | 'omitted' | 'empty' | 'skipped';
  value?: unknown;
}

interface HttpLogFields {
  parentSpanId?: string;
  callSpanId?: string;
  spanId?: string;
  route?: string;
  httpDetails?: Record<string, TraceHttpSection>;
  method?: string;
  path?: string;
  routePath?: string;
  url?: string;
  status?: number;
  priority?: string;
  startedAtMs?: number;
  durationMs?: number;
  service?: string;
  instance?: string;
  upstreamAddress?: string;
}

export function parseLog(message: string) {
  const [firstLine, nextLine] = message.trimStart().split(/\r?\n/, 2);
  const prefix = sdkPrefix.exec(firstLine);
  const content = prefix ? firstLine.slice(prefix[0].length) : firstLine;
  let fields: HttpLogFields | undefined;
  if (content.startsWith('{')) {
    try {
      fields = JSON.parse(content) as HttpLogFields;
    } catch {
      // Old or multiline entries still have a readable first line.
    }
  }
  const spanId = /\[traceId=[a-f\d]{32} spanId=([a-f\d]{16})\]/i.exec(prefix?.[0] ?? '')?.[1];
  return { content, context: prefix?.[1], nextLine, fields, spanId };
}

export function formatTraceRequest(fields?: HttpLogFields): string | undefined {
  const path = fields?.routePath ?? fields?.path ?? fields?.route ?? fields?.url;
  if (typeof fields?.method === 'string' && typeof path === 'string') {
    return fields.method + ' ' + path.split('?')[0];
  }
}

export function summarizeTraceLog(message: string) {
  const { content, nextLine, fields, context } = parseLog(message);
  const request = formatTraceRequest(fields);
  if (request && fields) {
    const parts = [request];
    if (typeof fields.status === 'number') parts.push('HTTP ' + fields.status);
    if (typeof fields.durationMs === 'number') parts.push(fields.durationMs + ' ms');
    if (context === 'GlobalExceptionFilter' && nextLine?.trim()) parts.push(nextLine.trim());
    return parts.join(' · ');
  }
  return content || nextLine?.trim() || '—';
}

export function orderTraceLogEntries(entries: TraceLogEntry[]) {
  const timeline = entries
    .map((entry) => {
      const { context, fields } = parseLog(entry.message);
      const gatewayCall = entry.service === 'gateway-service' && context === 'GatewayProxyService';
      const startedAtMs = fields?.startedAtMs;
      const hasStartTime =
        (gatewayCall || context === 'SystemRequestLog' || context === 'ServiceRequestLog') &&
        typeof startedAtMs === 'number' &&
        Number.isSafeInteger(startedAtMs) &&
        startedAtMs > 0 &&
        startedAtMs <= 8_640_000_000_000_000;
      const timestampNs = hasStartTime ? String(startedAtMs) + '000000' : entry.timestampNs;
      return { entry, gatewayCall, hasStartTime, timestampNs, order: BigInt(timestampNs) };
    })
    .sort((left, right) => (left.order < right.order ? -1 : left.order > right.order ? 1 : 0));

  // The first gateway proxy entry is the ingress. Keep it ahead of its downstream
  // events even for old logs and second-resolution exceptions.
  const ingress = timeline.findIndex((row) => row.gatewayCall);
  if (ingress > 0) timeline.unshift(timeline.splice(ingress, 1)[0]);
  return timeline;
}

export function listUncollectedTargets(entries: TraceLogEntry[]): string[] {
  const collected = new Set(entries.map((entry) => entry.instance));
  const addresses = new Set(
    entries
      .filter((entry) => entry.instanceAddress)
      .map((entry) => entry.service + '/' + entry.instanceAddress?.toLowerCase()),
  );
  const missing = new Set<string>();
  for (const entry of entries) {
    if (entry.service !== 'gateway-service') continue;
    const { context, fields } = parseLog(entry.message);
    const instance = fields?.instance;
    if (context !== 'GatewayProxyService') continue;
    const service = fields?.service;
    const upstreamAddress = fields?.upstreamAddress;
    if (instance && collected.has(instance)) continue;
    if (typeof upstreamAddress === 'string' && upstreamAddress) {
      if (!addresses.has(service + '/' + upstreamAddress.toLowerCase()))
        missing.add(upstreamAddress);
      continue;
    }
    if (typeof instance !== 'string') continue;
    const prefix = service + '-';
    const address =
      service && instance.startsWith(prefix)
        ? /^(.+)-(\d+)$/.exec(instance.slice(prefix.length))
        : null;
    if (!address) {
      missing.add(instance);
      continue;
    }
    const [, host, port] = address;
    missing.add(
      (host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host) + ':' + port,
    );
  }
  return [...missing];
}

type OrderedTraceLog = ReturnType<typeof orderTraceLogEntries>[number];

export interface TraceCallNode {
  id: string;
  row: OrderedTraceLog;
  logs: TraceLogEntry[];
  children: TraceCallNode[];
}

function spanKey(value: string | undefined): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{16}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

export function buildTraceCallTree(entries: TraceLogEntry[]): TraceCallNode[] {
  const byId = new Map<string, TraceCallNode>();
  const parentIds = new Map<string, string>();
  const aliases = new Map<string, string>();
  const primary = new Map<string, number>();

  for (const row of orderTraceLogEntries(entries)) {
    const { context, fields, spanId } = parseLog(row.entry.message);
    const inbound = spanKey(spanId);
    const remote = context === 'RemoteClientBase' ? spanKey(fields?.spanId) : undefined;
    const id = remote ?? inbound ?? row.entry.entryId;
    const node = byId.get(id) ?? { id, row, logs: [], children: [] };
    byId.set(id, node);
    node.logs.push(row.entry);

    const gateway = context === 'GatewayProxyService';
    const completion = context === 'SystemRequestLog' || context === 'ServiceRequestLog';
    const rank = gateway || completion ? 3 : remote && fields?.status !== undefined ? 2 : 1;
    if (rank > (primary.get(id) ?? 0)) {
      primary.set(id, rank);
      node.row = row;
    }
    const parentId = remote ? inbound : spanKey(fields?.parentSpanId);
    if (parentId && parentId !== id) parentIds.set(id, parentId);
    const callSpan = gateway && spanKey(fields?.callSpanId);
    if (callSpan && callSpan !== id) aliases.set(callSpan, id);
  }

  const roots: TraceCallNode[] = [];
  const parents = new Map<string, string>();
  const gateways = [...byId.values()].filter(({ row }) => row.gatewayCall);
  for (const node of byId.values()) {
    const parentId = parentIds.get(node.id);
    let parent = parentId ? byId.get(aliases.get(parentId) ?? parentId) : undefined;

    // Old gateway records lack span linkage. Only attach a uniquely matching target.
    if (!parent && !parentId && node.row.entry.service !== 'gateway-service') {
      const entry = node.row.entry;
      const matches = gateways.filter(({ row }) => {
        const { fields } = parseLog(row.entry.message);
        return (
          !fields?.callSpanId &&
          fields?.service === entry.service &&
          (fields?.instance === entry.instance ||
            (!!entry.instanceAddress && fields?.upstreamAddress === entry.instanceAddress))
        );
      });
      if (matches.length === 1) parent = matches[0];
    }

    let ancestor = parent?.id;
    while (ancestor && ancestor !== node.id) ancestor = parents.get(ancestor);
    if (!parent || ancestor === node.id) {
      roots.push(node);
      continue;
    }
    parents.set(node.id, parent.id);
    parent.children.push(node);
  }
  return roots;
}

export const TRACE_NODE_SIZE = { width: 280, height: 136 } as const;

type TracePort = { x: number; y: number };

export function layoutTraceCallTree(roots: TraceCallNode[]) {
  const columnGap = 38;
  const rowGap = 100;
  const padding = 24;
  const nodes: { node: TraceCallNode; x: number; y: number }[] = [];
  const edges: {
    id: string;
    parentId: string;
    path: string;
    from: TracePort;
    to: TracePort;
    depth: number;
    failed: boolean;
    highPriority: boolean;
  }[] = [];
  let nextColumn = 0;
  let deepest = 0;

  function place(node: TraceCallNode, depth: number): number {
    const y = padding + depth * (TRACE_NODE_SIZE.height + rowGap);
    const positioned = { node, x: 0, y };
    nodes.push(positioned);
    deepest = Math.max(deepest, depth);
    const children = node.children.map((child) => place(child, depth + 1));
    const center = children.length
      ? (children[0] + children[children.length - 1]) / 2
      : padding + TRACE_NODE_SIZE.width / 2 + nextColumn++ * (TRACE_NODE_SIZE.width + columnGap);
    positioned.x = center - TRACE_NODE_SIZE.width / 2;

    const fromY = y + TRACE_NODE_SIZE.height;
    const toY = fromY + rowGap;
    // Dense fan-outs can share a port. Keep distinct 12px ports spaced and inside the card.
    const portSpacing = 22;
    const portCount = Math.min(children.length, 9);
    for (const [index, target] of children.entries()) {
      const child = node.children[index];
      const { fields } = parseLog(child.row.entry.message);
      const port = Math.round((index * (portCount - 1)) / Math.max(1, children.length - 1));
      const from = { x: center + 17 + (port - (portCount - 1) / 2) * portSpacing, y: fromY };
      const to = { x: target - 17, y: toY };
      // Keep both port tangents vertical. Wider branches ease into the turn for longer.
      const handle = Math.min(rowGap * 0.74, rowGap * 0.47 + Math.abs(to.x - from.x) * 0.095);
      edges.push({
        id: child.id,
        parentId: node.id,
        path: `M ${from.x} ${from.y} C ${from.x} ${from.y + handle}, ${to.x} ${to.y - handle}, ${to.x} ${to.y}`,
        from,
        to,
        depth,
        failed: (fields?.status ?? 0) >= 400 || child.row.entry.level === 'ERROR',
        highPriority: fields?.priority === 'high',
      });
    }
    return center;
  }

  roots.forEach((root) => place(root, 0));
  return {
    nodes,
    edges,
    width: padding * 2 + Math.max(1, nextColumn) * (TRACE_NODE_SIZE.width + columnGap) - columnGap,
    height: padding * 2 + TRACE_NODE_SIZE.height + deepest * (TRACE_NODE_SIZE.height + rowGap),
  };
}
