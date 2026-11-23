import { ApiClient } from '../../../shared/api/apiClient';

export interface TraceLogEntry {
  entryId: string;
  timestampNs: string;
  service: string;
  instance: string;
  instanceAddress: string | null;
  level: string | null;
  message: string;
}

interface TraceLogResult {
  list: TraceLogEntry[];
  truncated: boolean;
}

export const TraceLogApi = {
  query(traceId: string) {
    return ApiClient.get<TraceLogResult>('/api/system/trace-logs', { traceId });
  },
  detail(traceId: string, entryId: string, signal: AbortSignal) {
    return ApiClient.request<{ message: string }>('/api/system/trace-logs/detail', {
      query: { traceId, entryId },
      signal,
    });
  },
};
