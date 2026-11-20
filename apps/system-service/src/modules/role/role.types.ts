import { RuntimeMenuRouteTreeRecord } from '../menu-route/menu-route.types';

export interface RoleMutationInput {
  code: string;
  name: string;
  description?: string;
  isEnabled?: boolean;
  permissionCodes?: string[];
}

export interface RoleRecord {
  id: number;
  code: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  permissionCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoleRuntimePreview {
  roleCode: string;
  menuTree: RuntimeMenuRouteTreeRecord[];
}

export interface RoleOptionRecord {
  code: string;
  name: string;
}
