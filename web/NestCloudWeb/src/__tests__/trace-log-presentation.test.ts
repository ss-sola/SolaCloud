import { describe, expect, it } from 'vitest';
import type { TraceLogEntry } from '../modules/system/api/traceLogApi';
import {
  listUncollectedTargets,
  orderTraceLogEntries,
  summarizeTraceLog,
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
