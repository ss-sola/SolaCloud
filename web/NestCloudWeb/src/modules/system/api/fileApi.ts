import { ApiClient } from '../../../shared/api/apiClient';
import type { PageQuery, PageResult } from '../types/common';

export interface FileItem {
  id: number;
  originalName: string;
  storageKey: string;
  storagePath: string;
  mimeType: string;
  size: number;
  extension: string;
  scene?: string;
  businessType?: string;
  isTemporary: boolean;
  status: string;
  url: string;
  previewUrl?: string;
  createdAt: string;
  updatedAt: string;
  bundleEntryPath?: string;
  isExtracted: boolean;
}

export interface FileQuery extends PageQuery {
  scene?: string;
  businessType?: string;
  status?: string;
  isTemporary?: string | boolean;
  keyword?: string;
}

export const FileApi = {
  listItems(query: FileQuery) {
    return ApiClient.get<PageResult<FileItem>>('/api/file/list', query);
  },

  getDetail(id: number) {
    return ApiClient.get<FileItem>('/api/file/detail', { id });
  },

  removeItem(id: number) {
    return ApiClient.delete<void>('/api/file/remove', { id });
  },
};
