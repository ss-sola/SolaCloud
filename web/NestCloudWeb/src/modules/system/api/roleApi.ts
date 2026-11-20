import { ApiClient } from '../../../shared/api/apiClient';
import type { RuntimeMenuRoute } from '../../../shared/api/systemApi';
import type { BaseEntityRecord, OverviewResponse, PageQuery, PageResult } from '../types/common';

export interface RoleItem extends Partial<BaseEntityRecord> {
  id: number;
  code: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  permissionCodes: string[];
}

export interface RoleQuery extends PageQuery {
  keyword?: string;
  isEnabled?: string | boolean;
}

export interface RoleOption {
  code: string;
  name: string;
}

export interface RoleSaveInput {
  code: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  permissionCodes: string[];
}

export interface RoleRuntimeResponse {
  roleCode: string;
  menuTree: RuntimeMenuRoute[];
}

export const RoleApi = {
  getOverview() {
    return ApiClient.get<OverviewResponse>('/api/system/roles/overview');
  },
  listItems(query: RoleQuery) {
    return ApiClient.get<PageResult<RoleItem>>('/api/system/roles', query);
  },
  listOptions() {
    return ApiClient.get<RoleOption[]>('/api/system/roles/options');
  },
  getItem(id: number) {
    return ApiClient.get<RoleItem>('/api/system/roles/item', { id });
  },
  getRuntime(roleCode: string) {
    return ApiClient.get<RoleRuntimeResponse>('/api/system/roles/runtime', { roleCode });
  },
  createItem(input: RoleSaveInput) {
    return ApiClient.post<RoleItem>('/api/system/roles', input);
  },
  updateItem(id: number, input: RoleSaveInput) {
    return ApiClient.put<RoleItem>('/api/system/roles/item', input, { id });
  },
  deleteItem(id: number) {
    return ApiClient.delete<void>('/api/system/roles/item', { id });
  },
};
