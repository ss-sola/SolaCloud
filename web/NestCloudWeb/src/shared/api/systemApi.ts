import { ApiClient } from './apiClient';

export interface CurrentAccount {
  accountId: number;
  accountName: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface RuntimeAccount {
  id: number;
  accountName: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface RuntimeMenuRoute {
  id: number;
  code: string;
  name: string;
  routeName?: string | null;
  icon?: string | null;
  isGroup: boolean;
  hideHeader: boolean;
  hideRoute: boolean;
  routeRoot?: string | null;
  isEnabled?: boolean;
  children: RuntimeMenuRoute[];
}

export interface RuntimePermissionCurrentResponse {
  account: RuntimeAccount;
  roleCodes: string[];
  menuTree: RuntimeMenuRoute[];
}

export interface LoginInput {
  accountName: string;
  password: string;
}

export interface LoginResult {
  accountId: number;
  accountName: string;
  displayName?: string;
  avatarUrl?: string;
}

export const SystemApi = {
  currentAccount() {
    return ApiClient.get<LoginResult | undefined>('/api/system/auth/current');
  },
  login(input: LoginInput) {
    return ApiClient.post<LoginResult>('/api/system/auth/login', input);
  },
  logout() {
    return ApiClient.post<{ success: boolean }>('/api/system/auth/logout');
  },
  runtimePermissions() {
    return ApiClient.get<RuntimePermissionCurrentResponse | undefined>(
      '/api/system/runtime-permissions/current',
    );
  },
};
