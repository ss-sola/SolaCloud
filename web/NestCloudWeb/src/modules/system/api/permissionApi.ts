import { ApiClient } from '../../../shared/api/apiClient';
import type { BaseEntityRecord, OverviewResponse, PageQuery, PageResult } from '../types/common';

export interface PermissionItem extends Partial<BaseEntityRecord> {
  code: string;
  name: string;
  groupKey?: string;
  description?: string;
  isEnabled: boolean;
}

export interface PermissionQuery extends PageQuery {
  keyword?: string;
  groupKey?: string;
  isEnabled?: string | boolean;
}

export interface PermissionSaveInput {
  code: string;
  name: string;
  groupKey?: string;
  description?: string;
  isEnabled: boolean;
}

export const PermissionApi = {
  getOverview() {
    return ApiClient.get<OverviewResponse>('/api/system/permissions/overview');
  },
  listItems(query: PermissionQuery) {
    return ApiClient.get<PageResult<PermissionItem>>('/api/system/permissions', query);
  },
  getItem(id: number) {
    return ApiClient.get<PermissionItem>('/api/system/permissions/item', { id });
  },
  createItem(input: PermissionSaveInput) {
    return ApiClient.post<PermissionItem>('/api/system/permissions', input);
  },
  updateItem(id: number, input: PermissionSaveInput) {
    return ApiClient.put<PermissionItem>('/api/system/permissions/item', input, { id });
  },
  deleteItem(id: number) {
    return ApiClient.delete<void>('/api/system/permissions/item', { id });
  },
};
