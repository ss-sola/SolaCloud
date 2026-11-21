import { getConfig, ProjectException } from '@nest-cloud/sdk';
import { HttpStatus, Injectable } from '@nestjs/common';
import { TRACE_ID_PATTERN, TRACE_LOG_QUERY } from '../../../constants/trace-log.constants';
import type { LokiLogQuery, LokiStream, TraceLogPreview, TraceLogResult } from '../trace-log.types';
import { TraceLogUtil } from '../trace-log.util';

const PREVIEW_TEMPLATE =
  '{{ printf "%d\\n%.' + TRACE_LOG_QUERY.previewLength + 's" (len (__line__)) (__line__) }}';
const PREVIEW_STAGE = ' | line_format ' + JSON.stringify(PREVIEW_TEMPLATE);
const GATEWAY_STAGE =
  ' |~ `^\\[[^\\]]+\\] [A-Z]+ +\\[traceId=[^\\]]+\\] \\[GatewayProxyService\\] `';
const OUTCOME_STAGE =
  ' |~ `^\\[[^\\]]+\\] [A-Z]+ +\\[traceId=[^\\]]+\\] \\[(SystemRequestLog|GlobalExceptionFilter)\\] `';

@Injectable()
export class TraceLogService {
  async query(traceId: string): Promise<TraceLogResult> {
    const traceFilter = this.getTraceFilter(traceId);
    const endpoint = this.getEndpoint();
    const endMs = Date.now();
    const range = {
      start: String(endMs - TRACE_LOG_QUERY.lookbackMs) + '000000',
      end: String(endMs) + '000000',
    };
    const signal = AbortSignal.timeout(TRACE_LOG_QUERY.timeoutMs);
    const primary = TraceLogUtil.toPreviews(
      await this.readLoki(
        endpoint,
        {
          ...range,
          query: this.getSelector() + traceFilter + PREVIEW_STAGE,
          limit: TRACE_LOG_QUERY.limit + 1,
        },
        signal,
      ),
    );
    if (primary.length <= TRACE_LOG_QUERY.limit) return { list: primary, truncated: false };

    // Completion records are written later than request-scoped detail. Query
    // them independently before filling the remainder with the earliest rows.
    const [gateway, outcomes] = await Promise.all([
      this.readLoki(
        endpoint,
        {
          ...range,
          query:
            this.getSelector('service="gateway-service"') +
            traceFilter +
            GATEWAY_STAGE +
            PREVIEW_STAGE,
          limit: TRACE_LOG_QUERY.keyLimit,
        },
        signal,
      ),
      this.readLoki(
        endpoint,
        {
          ...range,
          query:
            this.getSelector('service!="gateway-service"') +
            traceFilter +
            OUTCOME_STAGE +
            PREVIEW_STAGE,
          limit: TRACE_LOG_QUERY.keyLimit,
          direction: 'backward',
        },
        signal,
      ),
    ]);
    const selected = new Map<string, TraceLogPreview>();
    for (const entry of [
      ...TraceLogUtil.toPreviews(gateway),
      ...TraceLogUtil.toPreviews(outcomes),
      ...primary,
    ]) {
      if (selected.size === TRACE_LOG_QUERY.limit) break;
      selected.set(entry.entryId, entry);
    }
    return { list: [...selected.values()].sort(TraceLogUtil.compareEntries), truncated: true };
  }

  async detail(traceId: string, entryId: string): Promise<{ message: string }> {
    const traceFilter = this.getTraceFilter(traceId);
    const identity = TraceLogUtil.decodeEntryId(entryId);
    if (!identity) throw new ProjectException('日志标识无效', HttpStatus.BAD_REQUEST);

    const endMs = Date.now();
    const timestamp = BigInt(identity.timestampNs);
    if (
      timestamp < BigInt(endMs - TRACE_LOG_QUERY.lookbackMs) * 1000000n ||
      timestamp > BigInt(endMs) * 1000000n
    )
      throw new ProjectException('日志已超出查询范围', HttpStatus.NOT_FOUND);

    const streamSelector = this.getSelector(
      `service=${JSON.stringify(identity.service)},instance=${JSON.stringify(identity.instance)}`,
    );
    const streams = await this.readLoki(
      this.getEndpoint(),
      {
        query: streamSelector + traceFilter,
        start: identity.timestampNs,
        end: String(timestamp + 1n),
        limit: TRACE_LOG_QUERY.detailCandidates + 1,
      },
      AbortSignal.timeout(TRACE_LOG_QUERY.timeoutMs),
    );
    const candidates = TraceLogUtil.toEntries(streams);
    const messages = new Set(
      candidates
        .filter(
          (entry) =>
            entry.timestampNs === identity.timestampNs &&
            TraceLogUtil.detailDigest(entry.message) === identity.digest,
        )
        .map((entry) => entry.message),
    );
    if (!messages.size) throw new ProjectException('该条日志已不可用', HttpStatus.NOT_FOUND);
    if (messages.size > 1 || candidates.length > TRACE_LOG_QUERY.detailCandidates) {
      throw new ProjectException('该时间点存在多条相近日志，无法确定原文', HttpStatus.CONFLICT);
    }
    const message = [...messages][0];
    if (Buffer.byteLength(message) > TRACE_LOG_QUERY.maxDetailBytes) {
      throw new ProjectException('该条原文超过大小上限', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    return { message };
  }

  private getTraceFilter(traceId: string): string {
    if (!TRACE_ID_PATTERN.test(traceId)) {
      throw new ProjectException('traceId 必须是 32 位非全零十六进制字符', HttpStatus.BAD_REQUEST);
    }
    return ' | trace_id = "' + traceId.toLowerCase() + '"';
  }

  private getSelector(matcher?: string): string {
    const job = getConfig<string>('TraceLogLokiJob', TRACE_LOG_QUERY.defaultJob);
    return '{job=' + JSON.stringify(job) + (matcher ? ',' + matcher : '') + '}';
  }

  private getEndpoint(): string {
    const endpoint = getConfig<string>('TraceLogLokiUrl', '');
    if (!endpoint)
      throw new ProjectException('集中日志查询尚未配置', HttpStatus.SERVICE_UNAVAILABLE);
    return endpoint;
  }

  private async readLoki(
    endpoint: string,
    query: LokiLogQuery,
    signal: AbortSignal,
  ): Promise<LokiStream[]> {
    try {
      const url = new URL(endpoint);
      url.pathname = url.pathname.replace(/\/+$/, '') + '/loki/api/v1/query_range';
      url.search = new URLSearchParams({
        query: query.query,
        start: query.start,
        end: query.end,
        direction: query.direction ?? 'forward',
        limit: String(query.limit),
      }).toString();
      const response = await fetch(url, { signal, redirect: 'error' });
      if (!response.ok || !response.body) throw new Error('Loki query failed');
      const payload = await this.readBoundedJson(response.body);
      if (
        payload.status !== 'success' ||
        payload.data?.resultType !== 'streams' ||
        !Array.isArray(payload.data.result)
      ) {
        throw new Error('Unexpected Loki query response');
      }
      return payload.data.result;
    } catch {
      throw new ProjectException('日志服务暂时不可用，请稍后重试', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private async readBoundedJson(body: ReadableStream<Uint8Array>): Promise<{
    status: string;
    data?: { resultType: string; result: LokiStream[] };
  }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > TRACE_LOG_QUERY.maxResponseBytes) {
          await reader.cancel();
          throw new Error('Loki response too large');
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join(''));
  }
}
