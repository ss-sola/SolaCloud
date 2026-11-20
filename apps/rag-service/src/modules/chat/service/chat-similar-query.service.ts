import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmbeddingService } from '../../knowledge/service/embedding.service';

/** 相似查询推荐结果 */
export interface SimilarQueryResult {
  messageId: number;
  content: string;
  assistantReply: string;
}

/** findSimilar 方法入参 */
export interface FindSimilarOptions {
  query: string;
  topK?: number;
  /** 限定在指定会话内检索（可选） */
  sessionId?: number;
  /** 限定仅检索这些创建人拥有的会话（可选，传入多个 accountId 做多用户隔离） */
  createUsers?: number[];
}

/**
 * 相似查询检索服务。
 * 通过 pgvector 余弦相似度匹配历史用户提问，
 * 返回最相似的 N 条历史问答对。
 */
@Injectable()
export class ChatSimilarQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * 根据输入查询文本，在历史用户消息中查找最相似的 N 条。
   * 每条结果包含用户问题和对应的助手回复。
   */
  async findSimilar(options: FindSimilarOptions): Promise<SimilarQueryResult[]> {
    const { query, topK = 3, sessionId, createUsers } = options;

    // 1. 将输入查询向量化
    const queryEmbedding = await this.embeddingService.embedText(query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // 2. 使用 pgvector 余弦相似度查询
    //    限定在当前账号可访问的会话范围内，防止跨用户数据泄露
    //    参数编号始终从 $1 开始连续递增
    let paramIndex = 1;
    const conditions: string[] = [`m.role = 'user'`, `m.query_embedding IS NOT NULL`];
    const params: (string | number)[] = [topK];

    if (sessionId) {
      conditions.push(`m.session_id = $${paramIndex++}`);
      params.push(sessionId);
    }

    if (createUsers && createUsers.length > 0) {
      conditions.push(
        `m.session_id IN (SELECT cs.id FROM rag_chat_session cs WHERE cs.create_user IN (${createUsers.map(() => `$${paramIndex++}`).join(',')}))`,
      );
      params.push(...createUsers);
    }

    const sql = `
      SELECT
        m.id AS message_id,
        m.content AS user_content,
        (
          SELECT a.content
          FROM rag_chat_message a
          WHERE a.session_id = m.session_id
            AND a.role = 'assistant'
            AND a.created_at > m.created_at
          ORDER BY a.created_at ASC
          LIMIT 1
        ) AS assistant_reply
      FROM rag_chat_message m
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.query_embedding <=> '${embeddingStr}'::vector
      LIMIT $${paramIndex}
    `;

    const results = await this.dataSource.query(sql, params);

    // 3. 过滤掉没有助手回复的记录
    return results
      .filter(
        (r: { assistant_reply: string | null }) =>
          r.assistant_reply !== null && r.assistant_reply !== undefined,
      )
      .map((r: { message_id: number; user_content: string; assistant_reply: string }) => ({
        messageId: r.message_id,
        content: r.user_content,
        assistantReply: r.assistant_reply,
      }));
  }
}
