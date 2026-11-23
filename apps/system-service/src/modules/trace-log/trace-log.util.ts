import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { TRACE_ENTRY_ID_MAX_LENGTH, TRACE_LOG_QUERY } from '../../constants/trace-log.constants';
import type {
  LokiStream,
  TraceLogEntry,
  TraceLogEntryIdentity,
  TraceLogPreview,
} from './trace-log.types';

export class TraceLogUtil {
  static toEntries(streams: LokiStream[]): TraceLogEntry[] {
    return streams
      .flatMap(({ stream, values }) =>
        values.map(([timestampNs, message, metadata]) => ({
          timestampNs,
          service: stream.service ?? '',
          instance: stream.instance ?? '',
          instanceAddress: TraceLogUtil.resolveAddress(stream),
          level:
            metadata?.level ??
            stream.level ??
            /^\[[^\r\n\]]+\]\s+([A-Z]+)\s/.exec(message)?.[1] ??
            null,
          message,
        })),
      )
      .sort(TraceLogUtil.compareEntries);
  }

  static compareEntries(left: TraceLogEntry, right: TraceLogEntry): number {
    const difference = BigInt(left.timestampNs) - BigInt(right.timestampNs);
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  static toPreviews(streams: LokiStream[]): TraceLogPreview[] {
    return TraceLogUtil.toEntries(streams).map((entry) => {
      const separator = entry.message.indexOf('\n');
      if (separator < 0 || !/^\d+$/.test(entry.message.slice(0, separator))) {
        throw new Error('Unexpected Loki preview');
      }
      const message = entry.message.slice(separator + 1);
      // Loki's projection prepends the original byte length to the bounded preview.
      const entryId = Buffer.from(
        JSON.stringify([
          entry.timestampNs,
          entry.service,
          entry.instance,
          TraceLogUtil.digest(entry.message),
        ]),
      ).toString('base64url');
      const level = entry.level ?? /^\[[^\r\n\]]+\]\s+([A-Z]+)\s/.exec(message)?.[1] ?? null;
      // The detail endpoint still verifies the digest against the original preview.
      const detail = /,"httpDetails":\{/.exec(message);
      return {
        ...entry,
        message: detail ? message.slice(0, detail.index) + '}' : message,
        level,
        entryId,
      };
    });
  }

  static decodeEntryId(entryId: string): TraceLogEntryIdentity | null {
    if (
      typeof entryId !== 'string' ||
      entryId.length > TRACE_ENTRY_ID_MAX_LENGTH ||
      !/^[a-zA-Z0-9_-]+$/.test(entryId)
    )
      return null;

    try {
      const decoded = Buffer.from(entryId, 'base64url');
      if (decoded.toString('base64url') !== entryId) return null;
      const fields: unknown = JSON.parse(decoded.toString('utf8'));
      if (!Array.isArray(fields) || fields.length !== 4) return null;
      const [timestampNs, service, instance, digest]: unknown[] = fields;
      if (
        typeof timestampNs !== 'string' ||
        !/^\d{19}$/.test(timestampNs) ||
        typeof service !== 'string' ||
        typeof instance !== 'string' ||
        typeof digest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(digest)
      )
        return null;
      return { timestampNs, service, instance, digest };
    } catch {
      return null;
    }
  }

  static detailDigest(message: string): string {
    // Go's format precision counts Unicode code points, as does this slice.
    const preview = Array.from(message).slice(0, TRACE_LOG_QUERY.previewLength).join('');
    return TraceLogUtil.digest(Buffer.byteLength(message) + '\n' + preview);
  }

  private static digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private static resolveAddress(stream: LokiStream['stream']): string | null {
    if (stream.instance_address) return stream.instance_address;
    const prefix = `${stream.service}-`;
    if (!stream.service || !stream.instance?.startsWith(prefix)) return null;

    // Existing Alloy targets use the registry's service-host-port instance ID.
    const match = /^(.+)-(\d{1,5})$/.exec(stream.instance.slice(prefix.length));
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return null;
    const [, host, port] = match;
    return isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
  }
}
