import { RemoteCall, RemoteClientBase, RemoteService, ResponseUtil } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';

/** 通知 RAG 服务生成附件描述 */
export interface NotifyAttachmentDescribeInput {
  fileId: number;
  fileUrl: string;
  mimeType: string;
  fileName: string;
}

/** 通知 RAG 服务删除附件向量化数据 */
export interface NotifyAttachmentDeletionInput {
  fileId: number;
}

/**
 * middleware-service 文件服务客户端（RAG 服务调用 middleware-service）。
 */
@Injectable()
@RemoteService({ name: 'middleware-service', url: 'http://localhost:3300/api' })
export class MiddlewareServiceClient extends RemoteClientBase {
  /** 更新附件描述 */
  @RemoteCall('/file/description', 'PUT', { retry: 'idempotent-write' })
  updateFileDescription(_arg: { id: number; description: string }): Promise<ResponseUtil<boolean>> {
    return this.self.updateFileDescription(_arg);
  }

  /** 通知删除附件向量化数据 */
  @RemoteCall('/rag/knowledge/delete-by-file', 'POST')
  notifyAttachmentDeletion(_arg: { fileId: number }): Promise<ResponseUtil<boolean>> {
    return this.self.notifyAttachmentDeletion(_arg);
  }
}
