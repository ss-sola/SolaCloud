import { RemoteCall, RemoteClientBase, RemoteService, ResponseUtil } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';

/** 通知 RAG 服务生成附件描述 */
export interface AttachmentDescribeInput {
  fileId: number;
  fileUrl: string;
  mimeType: string;
  fileName: string;
}

/** 通知 RAG 服务删除附件向量化数据 */
export interface AttachmentDeleteInput {
  fileId: number;
}

/** 触发附件自动向量化请求 */
export interface AutoVectorizeForm {
  fileId: number;
  fileUrl: string;
  mimeType: string;
  fileName: string;
  description: string;
}

/**
 * RAG 服务客户端。
 * middleware-service 通过此类调用 RAG 服务，替代裸 fetch。
 */
@Injectable()
@RemoteService({ name: 'rag-service', url: 'http://localhost:3400/api' })
export class RagServiceClient extends RemoteClientBase {
  /** 通知 RAG 服务生成附件描述 */
  @RemoteCall('/rag/knowledge/attachment-describe', 'POST', { timeout: 0 })
  describeAttachment(_arg: AttachmentDescribeInput): Promise<ResponseUtil<string>> {
    return this.self.describeAttachment(_arg);
  }

  /** 通知 RAG 服务删除附件向量化数据 */
  @RemoteCall('/rag/knowledge/delete-by-file', 'POST', { timeout: 0 })
  deleteByFile(_arg: AttachmentDeleteInput): Promise<ResponseUtil<boolean>> {
    return this.self.deleteByFile(_arg);
  }

  /** 触发附件自动向量化（描述生成后调用） */
  @RemoteCall('/rag/knowledge/auto-vectorize', 'POST', { timeout: 0 })
  autoVectorize(_arg: AutoVectorizeForm): Promise<ResponseUtil<boolean>> {
    return this.self.autoVectorize(_arg);
  }
}
