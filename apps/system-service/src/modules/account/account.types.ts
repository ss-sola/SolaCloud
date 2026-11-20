import { RuntimeMenuRouteTreeRecord } from '../menu-route/menu-route.types';

export interface AccountRecord {
  id: number;
  accountName: string;
  displayName: string;
  avatarUrl?: string;
  isEnabled: boolean;
  failedLoginCount: number;
  lockedUntil?: string;
  lastLoginAt?: string;
  remark?: string;
  roleCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AccountOptionRecord {
  id: number;
  accountName: string;
  displayName: string;
}

export interface AccountMutationInput {
  accountName: string;
  displayName: string;
  avatarUrl?: string;
  password?: string;
  isEnabled?: boolean;
  remark?: string;
}

export interface AccountSessionPayload {
  accountId: number;
  accountName: string;
  displayName: string;
  avatarUrl?: string;
  statusVersion: number;
  loginAt: string;
  /** 用户拥有的权限码列表，登录时写入，权限变更时自动同步 */
  permissionCodes: string[];
}

export interface AccountRuntimePermission {
  account: {
    id: number;
    accountName: string;
    displayName: string;
    avatarUrl?: string;
  };
  roleCodes: string[];
  permissionCodes: string[];
  menuTree: RuntimeMenuRouteTreeRecord[];
}

export interface PermissionCheckResult {
  allowed: boolean;
  missingPermissionCodes: string[];
}

export interface LoginLogInput {
  accountId?: number;
  accountName: string;
  eventType: string;
  success: boolean;
  message: string;
  ip?: string;
  userAgent?: string;
}
