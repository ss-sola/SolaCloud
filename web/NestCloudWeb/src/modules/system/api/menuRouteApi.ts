import { ApiClient } from '../../../shared/api/apiClient';
import type { BaseEntityRecord, OverviewResponse, PageQuery } from '../types/common';

export interface MenuRouteItem extends Partial<BaseEntityRecord> {
  id: number;
  code: string;
  name: string;
  routeName?: string | null;
  parentId?: number | null;
  redirect?: string | null;
  icon?: string | null;
  sort: number;
  isEnabled: boolean;
  isGroup: boolean;
  hideHeader: boolean;
  hideRoute: boolean;
  routeRoot?: string | null;
  permissionCodes: string[];
}

export interface MenuRouteQuery extends PageQuery {
  keyword?: string;
  parentId?: string | number;
  isEnabled?: string | boolean;
}

export interface MenuRouteSaveInput {
  name: string;
  parentId?: number;
  routeName?: string;
  redirect?: string;
  icon?: string;
  sort: number;
  isEnabled: boolean;
  isGroup: boolean;
  hideHeader: boolean;
  hideRoute: boolean;
  routeRoot?: string;
  permissionCodes: string[];
}

export interface MenuRouteCreateInput extends MenuRouteSaveInput {
  code: string;
}

export interface MenuRouteBatchStatusInput {
  ids: number[];
  isEnabled: boolean;
}

export interface MenuRouteReorderInput {
  items: Array<{
    id: number;
    sort: number;
  }>;
}

export const MenuRouteApi = {
  getOverview() {
    return ApiClient.get<OverviewResponse>('/api/system/menu-routes/overview');
  },
  listItems(query: MenuRouteQuery) {
    return ApiClient.get<MenuRouteItem[]>('/api/system/menu-routes/list', query);
  },
  getTree() {
    return ApiClient.get<MenuRouteItem[]>('/api/system/menu-routes/tree');
  },
  getItem(id: number) {
    return ApiClient.get<MenuRouteItem>('/api/system/menu-routes/item', { id });
  },
  createItem(input: MenuRouteCreateInput) {
    return ApiClient.post<MenuRouteItem>('/api/system/menu-routes', input);
  },
  updateItem(id: number, input: MenuRouteSaveInput) {
    return ApiClient.put<MenuRouteItem>('/api/system/menu-routes/item', input, { id });
  },
  deleteItem(id: number) {
    return ApiClient.delete<void>('/api/system/menu-routes/item', { id });
  },
  updateBatchStatus(input: MenuRouteBatchStatusInput) {
    return ApiClient.put<void>('/api/system/menu-routes/batch-status', input);
  },
  reorder(input: MenuRouteReorderInput) {
    return ApiClient.put<void>('/api/system/menu-routes/reorder', input);
  },
};
