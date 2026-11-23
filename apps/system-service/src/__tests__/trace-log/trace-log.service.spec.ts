import { getConfig } from '@nest-cloud/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraceLogService } from '@/modules/trace-log/service/trace-log.service';
import type { LokiStream } from '@/modules/trace-log/trace-log.types';

vi.mock('@nest-cloud/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nest-cloud/sdk')>()),
  getConfig: vi.fn(),
}));

const traceId = '4f87fad557e6318744b192840b474a4c';
const project = (message: string) =>
  Buffer.byteLength(message) + '\n' + Array.from(message).slice(0, 1200).join('');
const streams = (result: LokiStream[]) =>
  Response.json({ status: 'success', data: { resultType: 'streams', result } });

describe('TraceLogService', () => {
  beforeEach(() => {
    vi.mocked(getConfig).mockImplementation((key, fallback) =>
      key === 'TraceLogLokiUrl' ? 'http://loki:3100' : fallback,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('merges Loki streams by nanosecond timestamp and returns the emitting instance addresses', async () => {
    const queryLoki = vi.fn(async () =>
      Response.json({
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { service: 'gateway-service', instance: 'gateway-service-127.0.0.1-3100' },
              values: [
                ['1795269821000000002', project('[2026-11-21 22:03:41] INFO  upstream complete')],
              ],
            },
            {
              stream: {
                service: 'system-service',
                instance: 'system-service-::1-3201',
                instance_address: '[fd00::1]:3201',
              },
              values: [['1795269821000000001', project('request handled'), { level: 'ERROR' }]],
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', queryLoki);

    const result = await new TraceLogService().query(traceId.toUpperCase());

    expect(queryLoki).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect((url as URL).searchParams.get('query')).toContain(
      `{job="solacloud-local"} | trace_id = "${traceId}" | line_format `,
    );
    expect(result).toMatchObject({
      list: [
        { service: 'system-service', instanceAddress: '[fd00::1]:3201', level: 'ERROR' },
        { service: 'gateway-service', instanceAddress: '127.0.0.1:3100', level: 'INFO' },
      ],
      truncated: false,
    });
  });

  it('reserves both completion rows even when 501 ordinary rows precede them', async () => {
    const selection = { service: 'system-service', instance: 'system-service-127.0.0.1-3201' };
    const base = 1795269821000000000n;
    const ordinary: LokiStream = {
      stream: selection,
      values: Array.from({ length: 501 }, (_, index) => [
        String(base + BigInt(index)),
        project('log ' + index),
      ]),
    };
    const gateway: LokiStream = {
      stream: { service: 'gateway-service', instance: 'gateway-service-127.0.0.1-3100' },
      values: [[String(base + 502n), project('gateway completion')]],
    };
    const completion: LokiStream = {
      stream: selection,
      values: [[String(base + 501n), project('system completion')]],
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(streams([ordinary]))
        .mockResolvedValueOnce(streams([gateway]))
        .mockResolvedValueOnce(streams([completion])),
    );

    const result = await new TraceLogService().query(traceId);
    expect(result.truncated).toBe(true);
    expect(result.list).toHaveLength(500);
    expect(result.list.slice(-2).map((row) => row.message)).toEqual([
      'system completion',
      'gateway completion',
    ]);
  });

  it('looks up one original from its trace, stream and timestamp using a Unicode-safe projection', async () => {
    const service = new TraceLogService();
    const timestamp = String(Date.now() - 2000) + '000003';
    const original = '多行⭐\n' + '𐐷'.repeat(1300) + '\nstack';
    const stream = { service: 'system-service', instance: 'system-service-127.0.0.1-3200' };
    const fetchLoki = vi
      .fn()
      .mockResolvedValueOnce(streams([{ stream, values: [[timestamp, project(original)]] }]))
      .mockResolvedValueOnce(streams([{ stream, values: [[timestamp, original]] }]));
    vi.stubGlobal('fetch', fetchLoki);
    const preview = (await service.query(traceId)).list[0];
    expect(preview.message).not.toContain('stack');
    await expect(service.detail(traceId, preview.entryId)).resolves.toEqual({ message: original });
    const url = fetchLoki.mock.calls[1][0] as URL;
    expect(url.searchParams.get('start')).toBe(timestamp);
    expect(url.searchParams.get('query')).toContain(`instance="${stream.instance}"`);
  });

  it.each(['0'.repeat(32), `${traceId}\n`, 'traceId" |~ ".*"'])(
    'rejects invalid traceId before querying Loki',
    async (invalidTraceId) => {
      const queryLoki = vi.fn();
      vi.stubGlobal('fetch', queryLoki);
      await expect(new TraceLogService().query(invalidTraceId)).rejects.toThrow('traceId');
      expect(queryLoki).not.toHaveBeenCalled();
    },
  );
});
