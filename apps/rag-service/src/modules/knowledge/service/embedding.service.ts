import { Injectable, Logger } from '@nestjs/common';
import { Embeddings } from '@langchain/core/embeddings';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RagConfigService } from '../../config/service/rag-config.service';

/**
 * Embedding 向量化抽象服务。
 * 通过 LangChain 抽象层支持多模型切换，运行时从 system-service 字典读取配置。
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(private readonly ragConfigService: RagConfigService) {}

  /** 获取文本的向量表示 */
  async embedText(text: string): Promise<number[]> {
    const startTime = Date.now();
    const embeddings = await this.createEmbeddingsInstance();
    const result = embeddings.embedQuery(text);
    const vector = await result;
    this.logger.log(`embedText 完成: 文本长度=${text.length}, 耗时=${Date.now() - startTime}ms`);
    return vector;
  }

  /** 批量获取文本的向量表示 */
  async embedTexts(texts: string[]): Promise<number[][]> {
    const startTime = Date.now();
    const embeddings = await this.createEmbeddingsInstance();
    const result = await embeddings.embedDocuments(texts);
    const dimension = result.length > 0 ? result[0].length : 0;
    this.logger.log(
      `embedTexts 完成: 文本数=${texts.length}, 向量维度=${dimension}, 耗时=${Date.now() - startTime}ms`,
    );
    return result;
  }

  /** 获取当前配置的向量维度 */
  async getDimension(): Promise<number> {
    const config = await this.ragConfigService.getEmbeddingConfig();
    return config.dimension;
  }

  /** 获取当前配置的模型名称 */
  async getModelName(): Promise<string> {
    const config = await this.ragConfigService.getEmbeddingConfig();
    return config.model;
  }

  private async createEmbeddingsInstance(): Promise<Embeddings> {
    const config = await this.ragConfigService.getEmbeddingConfig();

    return new OpenAIEmbeddings({
      model: config.model,
      openAIApiKey: config.apiKey || undefined,
      dimensions: config.dimension,
      configuration: { baseURL: config.baseUrl, apiKey: config.apiKey },
    });
  }
}
