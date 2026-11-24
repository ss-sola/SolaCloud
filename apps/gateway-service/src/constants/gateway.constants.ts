import { REGISTRY_LEASE_TIMEOUT_MS } from '@nest-cloud/sdk';

export const GATEWAY_MODE = { static: 'static', registry: 'registry' } as const;
export const UPSTREAM = {
  system: 'system-service',
  file: 'middleware-service',
  rag: 'rag-service',
  callGraph: 'call-graph-service',
} as const;
export type UpstreamName = (typeof UPSTREAM)[keyof typeof UPSTREAM];

export const GATEWAY_DEFAULTS = {
  port: 3100,
  allowedOrigins:
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173',
  systemUrl: 'http://127.0.0.1:3200',
  fileUrl: 'http://127.0.0.1:3300',
  ragUrl: 'http://127.0.0.1:3400',
  callGraphUrl: 'http://127.0.0.1:3500',
  syncMs: 15_000,
  snapshotMs: 45_000,
  leaseMs: REGISTRY_LEASE_TIMEOUT_MS,
  connectMs: 3_000,
  idleMs: 60_000,
  streamIdleMs: 180_000,
  bodyBytes: 102 * 1024 * 1024,
} as const;
