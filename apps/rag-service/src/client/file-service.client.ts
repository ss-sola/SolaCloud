import { RemoteCall, RemoteClientBase, RemoteService, ResponseUtil } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';

/** middleware-service 文件详情响应体（与 FileRecord 对齐） */
export interface FileDetailResponse {
  id: number;
  originalName: string;
  storageKey: string;
  storagePath: string;
  url: string;
  previewUrl?: string;
  mimeType: string;
  size: number;
  extension?: string;
  scene?: string;
  businessType?: string;
  isTemporary: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  bundleEntryPath?: string;
  isExtracted: boolean;
  description?: string | null;
}

/** 通知 RAG 服务生成附件描述请求 */
export interface NotifyAttachmentDescribeInput {
  fileId: number;
  fileUrl: string;
  mimeType: string;
  fileName: string;
}

/** 通知 RAG 服务删除附件向量化数据请求 */
export interface NotifyAttachmentDeletionInput {
  fileId: number;
}

/**
 * middleware-service 文件服务客户端。
 * dev 直接使用装饰器中的 url，prod 忽略 url 通过 name 从注册中心获取地址。
 */
@Injectable()
@RemoteService({ name: 'middleware-service', url: 'http://localhost:3300/api' })
export class FileServiceClient extends RemoteClientBase {
  /** 根据 fileId 获取文件详情 */
  @RemoteCall('/file/detail', 'GET')
  getFileDetail(_arg: { id: number }): Promise<ResponseUtil<FileDetailResponse>> {
    return this.self.getFileDetail(_arg);
  }

  /** 批量查询文件详情 */
  @RemoteCall('/file/batch-detail', 'POST', { retry: 'read' })
  getFileDetailBatch(_arg: { ids: number[] }): Promise<ResponseUtil<FileDetailResponse[]>> {
    return this.self.getFileDetailBatch(_arg);
  }

  /** 更新附件描述 */
  @RemoteCall('/file/description', 'PUT', { retry: 'idempotent-write' })
  updateFileDescription(_arg: { id: number; description: string }): Promise<ResponseUtil<boolean>> {
    return this.self.updateFileDescription(_arg);
  }
}
