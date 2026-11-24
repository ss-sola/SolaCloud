import {
  ProjectException,
  RemoteCall,
  RemoteClientBase,
  RemoteService,
  type ResponseUtil,
} from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { DEFAULT_PROBE_LIMITS, PROBE_DICTIONARY } from '../../constants/probe-limits.constants';

type DictionaryItem = { key: string; value: unknown };

@Injectable()
@RemoteService({ name: 'system-service', url: 'http://127.0.0.1:3200/api' })
export class ProbeDictionaryClient extends RemoteClientBase {
  @RemoteCall('/system/dictionaries/runtime', 'GET')
  getItems(query: typeof PROBE_DICTIONARY): Promise<ResponseUtil<DictionaryItem[]>> {
    return this.self.getItems(query);
  }

  async readLimits() {
    let response: ResponseUtil<DictionaryItem[]>;
    try {
      response = await this.getItems(PROBE_DICTIONARY);
    } catch {
      throw new ProjectException('无法读取接口调用图探针字典，请检查系统服务后再启动', 503);
    }
    if (response?.code !== 200 || !Array.isArray(response.data))
      throw new ProjectException('系统服务未返回接口调用图探针字典，请重试', 503);

    const limits = { ...DEFAULT_PROBE_LIMITS };
    for (const { key, value } of response.data) {
      if (key !== 'maxCallsPerRequest' && key !== 'maxSnapshotValuesPerCall') continue;
      const count = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
        throw new ProjectException(`探针字典 ${key} 须填写非负整数，0 表示不限制`, 422);
      limits[key] = count;
    }
    return limits;
  }
}
