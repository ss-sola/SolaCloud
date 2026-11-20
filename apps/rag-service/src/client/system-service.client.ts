import { RemoteCall, RemoteClientBase, RemoteService, ResponseUtil } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';

/** system-service 字典项运行时响应 */
export interface DictItemResponse {
  id: number;
  namespace: string;
  aggregateKey: string;
  key: string;
  value: unknown;
  label?: string;
  description?: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * system-service 系统服务客户端。
 */
@Injectable()
@RemoteService({ name: 'system-service', url: 'http://localhost:3200/api' })
export class SystemServiceClient extends RemoteClientBase {
  /** 获取字典运行时数据 */
  @RemoteCall('/system/dictionaries/runtime', 'GET')
  getDictionaryRuntimeItems(_arg: {
    namespace: string;
    aggregateKey: string;
  }): Promise<ResponseUtil<DictItemResponse[]>> {
    return this.self.getDictionaryRuntimeItems(_arg);
  }
}
