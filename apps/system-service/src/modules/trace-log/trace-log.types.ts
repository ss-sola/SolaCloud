export interface TraceLogEntry {
  timestampNs: string;
  service: string;
  instance: string;
  instanceAddress: string | null;
  level: string | null;
  message: string;
}

export interface TraceLogPreview extends TraceLogEntry {
  entryId: string;
}

export interface TraceLogResult {
  list: TraceLogPreview[];
  truncated: boolean;
}

export interface TraceLogEntryIdentity {
  timestampNs: string;
  service: string;
  instance: string;
  digest: string;
}

export interface LokiLogQuery {
  query: string;
  start: string;
  end: string;
  limit: number;
  direction?: 'forward' | 'backward';
}

export interface LokiStream {
  stream: {
    service?: string;
    instance?: string;
    instance_address?: string;
    level?: string;
  };
  values: [timestampNs: string, message: string, metadata?: { level?: string }][];
}
