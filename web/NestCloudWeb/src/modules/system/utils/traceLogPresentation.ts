import type { TraceLogEntry } from '../api/traceLogApi';

const sdkPrefix = /^\[[^\]]+\]\s+[A-Z]+\s+(?:\[traceId=[^\]]+\]\s+)?\[([^\]]+)\]\s*/;

interface HttpLogFields {
  method?: string;
  path?: string;
  routePath?: string;
  url?: string;
  status?: number;
  startedAtMs?: number;
  durationMs?: number;
  service?: string;
  instance?: string;
  upstreamAddress?: string;
}

function parseLog(message: string) {
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
  return { content, context: prefix?.[1], nextLine, fields };
}

export function summarizeTraceLog(message: string) {
  const { content, nextLine, fields, context } = parseLog(message);
  const path = fields?.routePath ?? fields?.path ?? fields?.url;
  if (typeof fields?.method === 'string' && typeof path === 'string') {
    const parts = [fields.method + ' ' + path.split('?')[0]];
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
        (gatewayCall || context === 'SystemRequestLog') &&
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
