import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_RETRIEVAL_SCORE_THRESHOLD,
  DEFAULT_RETRIEVAL_TOP_K,
} from '../../../constants/rag.constants';
import { SystemServiceClient } from '../../../client/system-service.client';

/** Chat AI 字典配置 */
export interface ChatLlmConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
}

/** 多模态字典配置 */
export interface MultimodalConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
}

/** 向量化字典配置 */
export interface EmbeddingConfig {
  model: string;
  dimension: number;
  baseUrl: string;
  apiKey: string;
  chunkSize: number;
  chunkOverlap: number;
  retrievalTopK: number;
  retrievalScoreThreshold: number;
}

/** system-service 字典项运行时记录 */
interface DictItem {
  key: string;
  value: unknown;
}

/** system-service 字典命名空间 */
const DICT_NAMESPACE = 'system';

/** 字典配置缓存 TTL（毫秒），5 分钟 */
const CONFIG_CACHE_TTL = 5 * 60 * 1000;

/**
 * RAG 配置服务。
 * 从 system-service 字典运行时接口读取 Chat AI 和向量化配置。
 * 配置读取后缓存 5 分钟，避免每次聊天请求都发起远程调用。
 */
@Injectable()
export class RagConfigService {
  private readonly logger = new Logger(RagConfigService.name);

  /** 配置缓存：key = "namespace:aggregateKey" */
  private readonly configCache = new Map<
    string,
    { data: Map<string, unknown>; fetchedAt: number }
  >();

  constructor(private readonly systemServiceClient: SystemServiceClient) {}

  /** 获取 Chat AI 字典配置，缺失键使用默认值。 */
  async getChatLlmConfig(): Promise<ChatLlmConfig> {
    const map = await this.fetchDictMap(DICT_NAMESPACE, 'chat-llm');
    return {
      model: this.stringValue(map, 'model', DEFAULT_LLM_MODEL),
      baseUrl: this.stringValue(map, 'baseUrl', ''),
      apiKey: this.stringValue(map, 'apiKey', ''),
    };
  }

  /** 获取多模态字典配置，缺失键使用默认值。 */
  async getMultimodalConfig(): Promise<MultimodalConfig> {
    const map = await this.fetchDictMap(DICT_NAMESPACE, 'multimodal');
    return {
      model: this.stringValue(map, 'model', DEFAULT_LLM_MODEL),
      baseUrl: this.stringValue(map, 'baseUrl', ''),
      apiKey: this.stringValue(map, 'apiKey', ''),
    };
  }

  /** 获取向量化字典配置，缺失键使用默认值。 */
  async getEmbeddingConfig(): Promise<EmbeddingConfig> {
    const map = await this.fetchDictMap(DICT_NAMESPACE, 'embedding');
    return {
      model: this.stringValue(map, 'model', DEFAULT_EMBEDDING_MODEL),
      dimension: this.numberValue(map, 'dimension', DEFAULT_EMBEDDING_DIMENSION),
      baseUrl: this.stringValue(map, 'baseUrl', ''),
      apiKey: this.stringValue(map, 'apiKey', ''),
      chunkSize: this.numberValue(map, 'chunkSize', DEFAULT_CHUNK_SIZE),
      chunkOverlap: this.numberValue(map, 'chunkOverlap', DEFAULT_CHUNK_OVERLAP),
      retrievalTopK: this.numberValue(map, 'retrievalTopK', DEFAULT_RETRIEVAL_TOP_K),
      retrievalScoreThreshold: this.numberValue(
        map,
        'retrievalScoreThreshold',
        DEFAULT_RETRIEVAL_SCORE_THRESHOLD,
      ),
    };
  }

  private async fetchDictMap(
    namespace: string,
    aggregateKey: string,
  ): Promise<Map<string, unknown>> {
    const cacheKey = `${namespace}:${aggregateKey}`;
    const cached = this.configCache.get(cacheKey);

    // 缓存命中且未过期
    if (cached && Date.now() - cached.fetchedAt < CONFIG_CACHE_TTL) {
      return cached.data;
    }

    try {
      const result = await this.systemServiceClient.getDictionaryRuntimeItems({
        namespace,
        aggregateKey,
      });
      const items: DictItem[] = result?.data ?? [];
      const data = new Map(items.map((item) => [item.key, item.value]));
      this.configCache.set(cacheKey, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      // 远程读取失败时，优先使用过期缓存作为降级
      if (cached) {
        this.logger.warn(
          `读取字典配置失败，降级使用过期缓存: ${cacheKey}, 错误: ${err instanceof Error ? err.message : err}`,
        );
        return cached.data;
      }
      this.logger.warn(
        `读取字典配置失败: ${cacheKey}, 将使用默认值: ${err instanceof Error ? err.message : err}`,
      );
      return new Map();
    }
  }

  private stringValue(map: Map<string, unknown>, key: string, defaultValue: string): string {
    const value = map.get(key);
    if (typeof value === 'string' && value.length > 0) return value;
    return defaultValue;
  }

  private numberValue(map: Map<string, unknown>, key: string, defaultValue: number): number {
    const value = map.get(key);
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return defaultValue;
  }
}
