import { ApiClient } from '../../../shared/api/apiClient';
import type { OverviewResponse, PageQuery, PageResult } from '../types/common';

export interface MonitorOverviewResponse extends OverviewResponse {
  onlineUserCount: number;
}

export interface ServiceMonitorCpuRecord {
  model: string;
  coreCount: number;
  loadAverage: number[];
  uptimeSeconds: number;
}

export interface ServiceMonitorMemoryRecord {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
  processRssBytes: number;
  processHeapTotalBytes: number;
  processHeapUsedBytes: number;
}

export interface ServiceMonitorDiskRecord {
  path: string;
  available: boolean;
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
  usedPercent?: number;
  errorMessage?: string;
}

export interface ServiceMonitorServerRecord {
  hostname: string;
  platform: string;
  arch: string;
  release: string;
  nodeVersion: string;
  pid: number;
}

export interface ServiceMonitorRecord {
  collectedAt: string;
  cpu: ServiceMonitorCpuRecord;
  memory: ServiceMonitorMemoryRecord;
  disk: ServiceMonitorDiskRecord;
  server: ServiceMonitorServerRecord;
}

export interface OnlineUserItem {
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

export interface OnlineUserQuery extends PageQuery {
  keyword?: string;
}

export interface KickOnlineUserInput {
  sessionId: string;
}

export interface KickOnlineUserResult {
  sessionId: string;
  kicked: true;
}

export const MonitorApi = {
  getOverview() {
    return ApiClient.get<MonitorOverviewResponse>('/api/system/monitors/overview');
  },
  getServiceMetrics() {
    return ApiClient.get<ServiceMonitorRecord>('/api/system/monitors/service');
  },
  listOnlineUsers(query: OnlineUserQuery) {
    return ApiClient.get<PageResult<OnlineUserItem>>('/api/system/monitors/online-users', query);
  },
  kickOnlineUser(input: KickOnlineUserInput) {
    return ApiClient.delete<KickOnlineUserResult>(
      '/api/system/monitors/online-users',
      undefined,
      input,
    );
  },
};
