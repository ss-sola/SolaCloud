/** Limit the time range, result size and cost of each Loki lookup. */
export const TRACE_LOG_QUERY = {
  lookbackMs: 24 * 60 * 60 * 1000,
  limit: 500,
  keyLimit: 64,
  previewLength: 1200,
  detailCandidates: 16,
  maxDetailBytes: 256 * 1024,
  maxResponseBytes: 6 * 1024 * 1024,
  timeoutMs: 5000,
  defaultJob: 'solacloud-local',
} as const;

export const TRACE_ID_PATTERN = /^(?!0{32})[a-f0-9]{32}(?![\s\S])/i;
export const TRACE_ENTRY_ID_MAX_LENGTH = 2048;
