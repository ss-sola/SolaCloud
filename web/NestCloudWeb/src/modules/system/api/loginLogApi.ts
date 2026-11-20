import { ApiClient } from '../../../shared/api/apiClient';
import type { BaseEntityRecord, OverviewResponse, PageQuery, PageResult } from '../types/common';

export interface LoginLogItem extends Partial<BaseEntityRecord> {
  id: number;
  accountName: string;
  eventType: string;
  success: boolean;
  message: string;
  ip?: string;
  userAgent?: string;
}

export interface LoginLogQuery extends PageQuery {
  accountName?: string;
  eventType?: string;
  success?: string | boolean;
  limit?: string | number;
}

export const LoginLogApi = {
  getOverview() {
    return ApiClient.get<OverviewResponse>('/api/system/login-logs/overview');
  },
  listItems(query: LoginLogQuery) {
    return ApiClient.get<PageResult<LoginLogItem>>('/api/system/login-logs', query);
  },
};
