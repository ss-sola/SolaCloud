export interface MenuRouteBaseInput {
  name: string;
  /** 前端路由名称，对应前端路由表的 name 字段，叶子节点必填 */
  routeName?: string;
  parentId?: number | null;
  redirect?: string;
  icon?: string;
  sort?: number;
  isEnabled?: boolean;
  isGroup?: boolean;
  hideHeader?: boolean;
  hideRoute?: boolean;
  routeRoot?: string;
  permissionCodes?: string[];
}

export interface MenuRouteCreateInput extends MenuRouteBaseInput {
  code: string;
}

export type MenuRouteUpdateInput = MenuRouteBaseInput;

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

export interface MenuRouteRecord {
  id: number;
  code: string;
  name: string;
  /** 前端路由名称，对应前端路由表的 name 字段 */
  routeName?: string;
  parentId?: number;
  redirect?: string;
  icon?: string;
  sort: number;
  isEnabled: boolean;
  isGroup: boolean;
  hideHeader: boolean;
  hideRoute: boolean;
  routeRoot?: string;
  permissionCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MenuRouteTreeRecord extends MenuRouteRecord {
  children: MenuRouteTreeRecord[];
}

export type RuntimeMenuRouteTreeRecord = Omit<
  MenuRouteRecord,
  'permissionCodes' | 'createdAt' | 'updatedAt'
> & {
  children: RuntimeMenuRouteTreeRecord[];
};
