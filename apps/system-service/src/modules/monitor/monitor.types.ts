export interface MonitorOverviewRecord {
  service: string;
  onlineUserCount: number;
  capabilities: string[];
}

export interface ServiceMonitorRecord {
  collectedAt: string;
  cpu: CpuMonitorRecord;
  memory: MemoryMonitorRecord;
  disk: DiskMonitorRecord;
  server: ServerMonitorRecord;
}

export interface CpuMonitorRecord {
  model: string;
  coreCount: number;
  loadAverage: number[];
  uptimeSeconds: number;
}

export interface MemoryMonitorRecord {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
  processRssBytes: number;
  processHeapTotalBytes: number;
  processHeapUsedBytes: number;
}

export interface DiskMonitorRecord {
  path: string;
  available: boolean;
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  usedPercent?: number;
  errorMessage?: string;
}

export interface ServerMonitorRecord {
  hostname: string;
  platform: string;
  arch: string;
  release: string;
  nodeVersion: string;
  pid: number;
}

export interface OnlineUserRecord {
  sessionId: string;
  accountId: number;
  accountName: string;
  displayName: string;
  avatarUrl?: string;
  ip?: string;
  userAgent?: string;
  loginAt: string;
  lastActiveAt: string;
  expiresAt: string;
}

export interface OnlineUserUpsertInput {
  sessionId?: string;
  accountId: number;
  accountName: string;
  displayName: string;
  avatarUrl?: string | null;
  sessionLoginAt?: string;
  ip?: string;
  userAgent?: string | string[];
}

export interface OnlineUserKickInput {
  sessionId: string;
  operatorSessionId?: string;
}

export interface OnlineUserKickResult {
  sessionId: string;
  kicked: true;
}
