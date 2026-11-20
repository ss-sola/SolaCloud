import { ApiClient } from '../../../shared/api/apiClient';
import type { BaseEntityRecord, OverviewResponse, PageQuery, PageResult } from '../types/common';

export interface OperationLogItem extends Partial<BaseEntityRecord> {
  id: number;
  module: string;
  action: string;
  targetType: string;
  targetId?: string | number;
  summary: string;
  operator?: string;
}

export interface OperationLogQuery extends PageQuery {
  module?: string;
  action?: string;
  targetType?: string;
  operator?: string;
}

export const OperationLogApi = {
  getOverview() {
    return ApiClient.get<OverviewResponse>('/api/system/operation-logs/overview');
  },
  listItems(query: OperationLogQuery) {
    return ApiClient.get<PageResult<OperationLogItem>>('/api/system/operation-logs', query);
  },
};
