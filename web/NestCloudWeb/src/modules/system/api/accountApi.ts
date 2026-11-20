import { ApiClient } from '../../../shared/api/apiClient';
import {
  uploadFileWithResume,
  type ResumableUploadOptions,
  type UploadProgressSnapshot,
} from '../../../shared/api/resumableUploadApi';
import type { BaseEntityRecord, OverviewResponse, PageQuery, PageResult } from '../types/common';

export interface AccountAvatarUploadConfig {
  uploadUrl?: string;
  scene?: string;
  businessType?: string;
  isTemporary?: boolean;
}

export interface AccountOverviewResponse extends OverviewResponse {
  avatarUpload?: AccountAvatarUploadConfig | null;
}

export interface AccountItem extends Partial<BaseEntityRecord> {
  id: number;
  accountName: string;
  displayName: string;
  isEnabled: boolean;
  avatarUrl?: string;
  remark?: string;
  roleCodes: string[];
  failedLoginCount?: number;
  lockedUntil?: string | null;
  lastLoginAt?: string | null;
}

export interface AccountQuery extends PageQuery {
  keyword?: string;
  isEnabled?: string | boolean;
}

export interface AccountOptionItem {
  id: number;
  accountName: string;
  displayName: string;
}

export interface AccountSaveInput {
  accountName: string;
  displayName: string;
  password?: string;
  isEnabled: boolean;
  avatarUrl?: string;
  remark?: string;
}

export interface AccountPasswordInput {
  password: string;
}

export interface AccountRoleBindingInput {
  roleCodes: string[];
}

export interface UploadFileResponse {
  url?: string;
  previewUrl?: string;
}

export interface UploadFileOptions extends Pick<
  ResumableUploadOptions,
  'file' | 'signal' | 'onProgress'
> {
  scene?: string;
  businessType?: string;
  isTemporary?: boolean;
}

export type { UploadProgressSnapshot };

export const AccountApi = {
  getOverview() {
    return ApiClient.get<AccountOverviewResponse>('/api/system/accounts/overview');
  },
  uploadFile(uploadUrl: string, options: UploadFileOptions) {
    return uploadFileWithResume({
      uploadUrl,
      file: options.file,
      scene: options.scene,
      businessType: options.businessType,
      isTemporary: options.isTemporary,
      signal: options.signal,
      onProgress: options.onProgress,
    }) as Promise<UploadFileResponse>;
  },
  listItems(query: AccountQuery) {
    return ApiClient.get<PageResult<AccountItem>>('/api/system/accounts', query);
  },
  listOptions() {
    return ApiClient.get<AccountOptionItem[]>('/api/system/accounts/options');
  },
  getItem(id: number) {
    return ApiClient.get<AccountItem>('/api/system/accounts/item', { id });
  },
  createItem(input: AccountSaveInput) {
    return ApiClient.post<AccountItem>('/api/system/accounts', input);
  },
  updateItem(id: number, input: AccountSaveInput) {
    return ApiClient.put<AccountItem>('/api/system/accounts/item', input, { id });
  },
  deleteItem(id: number) {
    return ApiClient.delete<void>('/api/system/accounts/item', { id });
  },
  updatePassword(id: number, input: AccountPasswordInput) {
    return ApiClient.put<void>('/api/system/accounts/password', input, { id });
  },
  getRoleBindings(id: number) {
    return ApiClient.get<AccountRoleBindingInput>('/api/system/accounts/roles', { id });
  },
  updateRoleBindings(id: number, input: AccountRoleBindingInput) {
    return ApiClient.put<void>('/api/system/accounts/roles', input, { id });
  },
};
