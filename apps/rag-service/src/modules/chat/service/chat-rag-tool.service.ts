import { Injectable, Logger } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { RetrievalResult, ChatRetrievalService } from './chat-retrieval.service';
import { RagConfigService } from '../../config/service/rag-config.service';

/** Tool 入参 */
export interface RagRetrieveToolInput {
  /** 检索查询文本 */
  query: string;
  /** 知识库 ID，不传则使用默认的知识库 */
  knowledgeBaseId?: number;
  /** 返回片段数量上限 */
  topK?: number;
}

/** 去重排序后的检索片段 */
export interface RankedFragment {
  chunkId: number;
  documentId: number;
  fileId: number | null;
  fileName: string;
  fileUrl: string | null;
  content: string;
  score: number;
}

/** 检索来源记录（写入 collector） */
export interface SourceRecord {
  chunkId: number;
  documentId: number;
  fileId: number | null;
  score: number;
}

/** 检索统计信息 */
export interface RetrieveStats {
  /** 返回的片段数 */
  fragmentCount: number;
  /** 累计检索量（含历史） */
  cumulativeCount: number;
  /** 去重前的原始结果数 */
  rawCount: number;
}

/** 单条片段最大字符数 */
const MAX_FRAGMENT_LENGTH = 2000;

/** 单次检索最大返回片段数 */
const MAX_TOP_K = 20;

/** 查询文本最大长度 */
const MAX_QUERY_LENGTH = 1000;

/** 单次检索返回的最大字符总量 */
const MAX_TOTAL_CHARS = 16000;

/**
 * RAG 检索 Deep Agents Tool 服务。
 *
 * 职责：
 * - 创建请求级 LangChain DynamicStructuredTool
 * - 调用 ChatRetrievalService 执行向量检索
 * - 按 chunkId 去重并稳定排序
 * - 强制附加已授权知识库过滤条件，排除已删除文档
 * - 集中管控查询长度、topK、片段长度、累计检索量上限
 * - 无知识库或检索失败时作为 Tool 结果/错误返回
 */
@Injectable()
export class ChatRagToolService {
  private readonly logger = new Logger(ChatRagToolService.name);

  constructor(
    private readonly chatRetrievalService: ChatRetrievalService,
    private readonly ragConfigService: RagConfigService,
  ) {}

  /**
   * 创建 RAG 检索 Tool。
   *
   * @param authorizedKnowledgeBaseIds - 当前账号已授权的知识库 ID 集合
   * @param sessionKnowledgeBaseId - 当前会话绑定的知识库 ID（可选）
   * @param cumulativeCountRef - 累计检索量引用（跨子 Agent 调用共享）
   * @returns LangChain DynamicStructuredTool 实例
   */
  createTool(cumulativeCountRef: { count: number }): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: 'rag_retrieve',
      description:
        '从知识库中检索与查询相关的文本片段。返回受控的文本内容和结构化来源信息。' +
        '支持多轮调用，结果会自动去重。',
      schema: this.buildSchema(),
      func: async (input: RagRetrieveToolInput) => this.execute(input, cumulativeCountRef),
    });
  }

  /** 构建 JSON Schema（与 RagRetrieveToolInput 对应） */
  private buildSchema(): any {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索查询文本',
        },
        knowledgeBaseId: {
          type: 'integer',
          description: '知识库 ID（可选，不传则使用会话绑定的知识库）',
        },
        topK: {
          type: 'integer',
          description: '返回片段数量上限（可选，默认 5，最大 20）',
        },
      },
      required: ['query'],
    };
  }

  /**
   * 执行检索逻辑。
   */
  private async execute(
    input: RagRetrieveToolInput,
    cumulativeCountRef: { count: number },
  ): Promise<string> {
    try {
      // 1. 查询长度校验
      const query = this.validateQuery(input.query);

      // 2. 确定知识库过滤条件：优先使用 Tool 入参，其次会话绑定
      const knowledgeBaseId = input.knowledgeBaseId || 0;

      // 4. topK 限流
      const topK = this.clampTopK(input.topK);

      // 5. 累计检索量检查
      const embedConfig = await this.ragConfigService.getEmbeddingConfig();
      const effectiveTopK = Math.min(topK, embedConfig.retrievalTopK);
      this.checkCumulativeLimit(cumulativeCountRef, effectiveTopK);

      // 6. 执行检索
      let results = await this.chatRetrievalService.retrieve({
        query,
        knowledgeBaseId,
        topK: effectiveTopK,
      });

      // 8. 按 chunkId 去重并稳定排序
      const deduplicated = this.deduplicateAndSort(results);

      // 9. 按累计字符量截断
      const truncated = this.truncateByCharLimit(deduplicated);

      // 10. 更新累计计数
      cumulativeCountRef.count += truncated.length;

      // 11. 构建返回结果
      const fragments = truncated.map((r) => this.toRankedFragment(r));
      const sourceRecords = truncated.map((r) => this.toSourceRecord(r));

      return JSON.stringify({
        success: true,
        fragments,
        sources: sourceRecords,
        stats: this.buildStats(truncated, cumulativeCountRef),
      });
    } catch (err) {
      // 所有异常都作为 Tool 结果返回，不向上抛出
      // 使 LLM 能看到错误并自行决策下一步
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`检索异常: ${message}`);
      return JSON.stringify({
        success: false,
        error: '检索异常',
        message,
        fragments: [],
        stats: this.buildStats([], cumulativeCountRef),
      });
    }
  }

  /**
   * 校验并截断查询文本。
   */
  private validateQuery(query: string): string {
    if (!query || query.trim().length === 0) {
      throw new Error('检索查询不能为空');
    }
    if (query.length > MAX_QUERY_LENGTH) {
      this.logger.warn(`查询文本超长: ${query.length} > ${MAX_QUERY_LENGTH}，已截断`);
      return query.slice(0, MAX_QUERY_LENGTH);
    }
    return query;
  }

  /**
   * 将 topK 钳制在允许范围内。
   */
  private clampTopK(topK: number | undefined): number {
    if (!topK || topK <= 0) {
      return 5;
    }
    if (topK > MAX_TOP_K) {
      this.logger.warn(`topK 超出上限: ${topK} > ${MAX_TOP_K}，已限制`);
      return MAX_TOP_K;
    }
    return topK;
  }

  /**
   * 检查累计检索量是否超限。
   */
  private checkCumulativeLimit(cumulativeCountRef: { count: number }, requested: number): void {
    const maxCumulative = MAX_TOTAL_CHARS;
    if (cumulativeCountRef.count + requested * MAX_FRAGMENT_LENGTH > maxCumulative) {
      throw new Error(
        `累计检索量已达上限（当前 ${cumulativeCountRef.count} 条，本次请求 ${requested} 条），请减少检索次数`,
      );
    }
  }

  /**
   * 按 chunkId 去重，保留首次出现（最高分数），然后按分数降序、chunkId 升序稳定排序。
   */
  private deduplicateAndSort(results: RetrievalResult[]): RetrievalResult[] {
    const seen = new Set<number>();
    const unique: RetrievalResult[] = [];

    for (const r of results) {
      if (!seen.has(r.chunkId)) {
        seen.add(r.chunkId);
        unique.push(r);
      }
    }

    unique.sort((a, b) => {
      // 优先按分数降序
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // 分数相同时按 chunkId 升序
      return a.chunkId - b.chunkId;
    });

    return unique;
  }

  /**
   * 按累计字符量截断结果。
   */
  private truncateByCharLimit(results: RetrievalResult[]): RetrievalResult[] {
    let totalChars = 0;
    const truncated: RetrievalResult[] = [];

    for (const r of results) {
      const contentLen = Math.min(r.content.length, MAX_FRAGMENT_LENGTH);
      if (totalChars + contentLen > MAX_TOTAL_CHARS) {
        this.logger.warn(`累计检索字符量已达上限: ${totalChars}/${MAX_TOTAL_CHARS}，停止追加片段`);
        break;
      }
      truncated.push(r);
      totalChars += contentLen;
    }

    return truncated;
  }

  /** 转换为 RankedFragment */
  private toRankedFragment(r: RetrievalResult): RankedFragment {
    return {
      chunkId: r.chunkId,
      documentId: r.documentId,
      fileId: r.fileId,
      fileName: r.fileName,
      fileUrl: r.fileUrl,
      content: r.content.slice(0, MAX_FRAGMENT_LENGTH),
      score: Math.round(r.score * 10000) / 10000,
    };
  }

  /** 转换为 SourceRecord */
  private toSourceRecord(r: RetrievalResult): SourceRecord {
    return {
      chunkId: r.chunkId,
      documentId: r.documentId,
      fileId: r.fileId,
      score: Math.round(r.score * 10000) / 10000,
    };
  }

  /** 构建统计信息 */
  private buildStats(
    results: RetrievalResult[],
    cumulativeCountRef: { count: number },
  ): RetrieveStats {
    return {
      fragmentCount: results.length,
      cumulativeCount: cumulativeCountRef.count,
      rawCount: results.length,
    };
  }
}
