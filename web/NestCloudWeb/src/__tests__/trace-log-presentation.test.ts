import { describe, expect, it } from 'vitest';
import type { TraceLogEntry } from '../modules/system/api/traceLogApi';
import {
  buildTraceCallTree,
  formatTraceRequest,
  layoutTraceCallTree,
  listUncollectedTargets,
  orderTraceLogEntries,
  parseLog,
  summarizeTraceLog,
  TRACE_NODE_SIZE,
} from '../modules/system/utils/traceLogPresentation';

const log = (fields: object, logger: string) =>
  '[2026-11-21 22:03:41] INFO  [traceId=0123 spanId=abcd] [' +
  logger +
  '] ' +
  JSON.stringify(fields);

describe('trace log presentation', () => {
  it.each([true, false])(
    'puts ingress ahead of downstream completion (start timestamps: %s)',
    (withStart) => {
      const base = { entryId: 'row', instanceAddress: null, level: 'INFO' };
      const downstream = {
        ...base,
        service: 'system-service',
        instance: 'system-3200',
        timestampNs: '1795269821000000000',
        message: log(withStart ? { startedAtMs: 1795269821002 } : {}, 'SystemRequestLog'),
      };
      const gateway = {
        ...base,
        service: 'gateway-service',
        instance: 'gateway-3100',
        timestampNs: '1795269821000000001',
        message: log(withStart ? { startedAtMs: 1795269821001 } : {}, 'GatewayProxyService'),
      };
      const rows = orderTraceLogEntries([downstream, gateway]);
      expect(rows.map(({ entry }) => entry.service)).toEqual(['gateway-service', 'system-service']);
      expect(rows[0].timestampNs).toBe(withStart ? '1795269821001000000' : gateway.timestampNs);
      expect(rows[0].hasStartTime).toBe(withStart);
    },
  );

  it('summarizes successful HTTP logs and removes detail lines and query strings', () => {
    const line = log(
      { method: 'GET', path: '/api/system/auth/current?filter=x', status: 200, durationMs: 12 },
      'SystemRequestLog',
    );
    expect(summarizeTraceLog(line + '\nstack frame')).toBe(
      'GET /api/system/auth/current · HTTP 200 · 12 ms',
    );
  });

  it('keeps arbitrary JSON logs readable when HTTP and span fields have other types', () => {
    const fields = { method: 'internal', path: ['not', 'http'], spanId: 1234567890123456 };
    const message = log(fields, 'RemoteClientBase');
    expect(formatTraceRequest(parseLog(message).fields)).toBeUndefined();
    expect(summarizeTraceLog(message)).toBe(JSON.stringify(fields));
    const entry = {
      message,
      entryId: 'unstructured',
      timestampNs: '1000000000',
      service: 'system-service',
      level: 'INFO',
      instance: 'system',
      instanceAddress: null,
    };
    expect(buildTraceCallTree([entry]).map((node) => node.id)).toEqual([entry.entryId]);
  });

  it('only shows a missing target if the gateway recorded the target and its log is absent', () => {
    const gateway: TraceLogEntry = {
      entryId: 'gateway',
      service: 'gateway-service',
      instance: 'gateway-service-127.0.0.1-3100',
      instanceAddress: '127.0.0.1:3100',
      timestampNs: '1795269821000000000',
      level: 'INFO',
      message: log(
        {
          instance: 'system-service-127.0.0.1-3201',
          service: 'system-service',
        },
        'GatewayProxyService',
      ),
    };
    expect(listUncollectedTargets([gateway])).toEqual(['127.0.0.1:3201']);
    expect(
      listUncollectedTargets([
        gateway,
        { ...gateway, service: 'system-service', instance: 'system-service-127.0.0.1-3201' },
      ]),
    ).toEqual([]);
  });

  it('matches a static gateway target by service and address when it has no registry ID', () => {
    const gateway: TraceLogEntry = {
      entryId: 'gateway',
      service: 'gateway-service',
      instance: 'gateway',
      instanceAddress: '127.0.0.1:3100',
      timestampNs: '1795269821000000000',
      level: 'INFO',
      message: log(
        { service: 'system-service', upstreamAddress: '127.0.0.1:3201' },
        'GatewayProxyService',
      ),
    };
    expect(listUncollectedTargets([gateway])).toEqual(['127.0.0.1:3201']);
    expect(
      listUncollectedTargets([
        gateway,
        {
          ...gateway,
          service: 'system-service',
          instanceAddress: '127.0.0.1:3201',
        },
      ]),
    ).toEqual([]);
  });
});

it('draws parallel calls under the recorded parent and groups exception logs into the service node', () => {
  const span = (n: number) => n.toString(16).padStart(16, '0');
  function row(
    service: string,
    entryId: string,
    spanId: number,
    context: string,
    fields: object,
  ): TraceLogEntry {
    return {
      entryId,
      service,
      instance: service,
      instanceAddress: null,
      level: 'INFO',
      timestampNs: '1795269821000000000',
      message: log(fields, context).replace(
        'traceId=0123 spanId=abcd',
        'traceId=' + 'a'.repeat(32) + ' spanId=' + span(spanId),
      ),
    };
  }
  const roots = buildTraceCallTree([
    row('rag-service', 'leaf', 5, 'ServiceRequestLog', { parentSpanId: span(4), priority: 'high' }),
    row('system-service', 'exception', 3, 'GlobalExceptionFilter', {}),
    row('system-service', 'remote', 3, 'RemoteClientBase', { spanId: span(4), status: 200 }),
    row('system-service', 'request', 3, 'SystemRequestLog', { parentSpanId: span(2) }),
    row('middleware-service', 'parallel', 6, 'ServiceRequestLog', {
      parentSpanId: span(3),
      status: 503,
    }),
    row('gateway-service', 'gateway', 1, 'GatewayProxyService', { callSpanId: span(2) }),
  ]);
  expect(roots.map((root) => root.id)).toEqual([span(1)]);
  const system = roots[0].children[0];
  expect(system.row.entry.entryId).toBe('request');
  expect(system.logs.map((entry) => entry.entryId)).toEqual(['exception', 'request']);
  expect(system.children.map((branch) => branch.id)).toEqual([span(4), span(6)]);
  expect(system.children[0].children[0].id).toBe(span(5));

  const layout = layoutTraceCallTree(roots);
  const positions = new Map(layout.nodes.map(({ node, x, y }) => [node.id, { x, y }]));
  const gateway = positions.get(span(1))!;
  const parent = positions.get(span(3))!;
  const left = positions.get(span(4))!;
  const right = positions.get(span(6))!;
  expect(gateway.y).toBeLessThan(parent.y);
  expect(parent.y).toBeLessThan(left.y);
  expect(left.y).toBe(right.y);
  expect(right.x - left.x).toBeGreaterThan(TRACE_NODE_SIZE.width);
  expect(parent.x).toBe((left.x + right.x) / 2);
  expect(layout.edges).toHaveLength(layout.nodes.length - 1);
  expect(layout.edges.filter((edge) => edge.highPriority).map((edge) => edge.id)).toEqual([
    span(5),
  ]);
  expect(layout.edges.filter((edge) => edge.failed)).toMatchObject([
    { id: span(6), parentId: span(3), depth: 1 },
  ]);
  expect(layout.edges.every((edge) => /^M [\d.]+ [\d.]+ C /.test(edge.path))).toBe(true);
  // The gateway and system cards share a center. Their ports and handles still form an S.
  expect(gateway.x).toBe(parent.x);
  const serial = layout.edges.find((edge) => edge.id === span(3))!;
  expect(serial.from.x - serial.to.x).toBe(34);
  expect(serial.from.y).toBe(gateway.y + TRACE_NODE_SIZE.height);
  expect(serial.to.y).toBe(parent.y);
  const [, , firstX, firstY, lastX, lastY] = serial.path.match(/-?[\d.]+/g)!.map(Number);
  expect(firstX).toBe(serial.from.x);
  expect(lastX).toBe(serial.to.x);
  expect(firstY).toBeGreaterThan(serial.from.y);
  expect(lastY).toBeLessThan(serial.to.y);
  const branches = layout.edges.filter((edge) => edge.parentId === span(3));
  expect(branches[0].from.x).toBeLessThan(branches[1].from.x);
  expect(branches[0].to.x).toBeLessThan(branches[1].to.x);

  const fanout = layoutTraceCallTree([
    {
      ...system,
      children: Array.from({ length: 30 }, (_, index) => ({
        ...system.children[1],
        id: 'branch-' + index,
      })),
    },
  ]);
  const ports = [...new Set(fanout.edges.map((edge) => edge.from.x))];
  expect(ports[0] - 7).toBeGreaterThan(fanout.nodes[0].x);
  expect(ports.at(-1)! + 7).toBeLessThan(fanout.nodes[0].x + TRACE_NODE_SIZE.width);
  expect(ports.slice(1).every((x, index) => x - ports[index] > 14)).toBe(true);
});
