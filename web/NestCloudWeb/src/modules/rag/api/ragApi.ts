import { ApiClient } from '../../../shared/api/apiClient';
import type {
  AttachmentInput,
  ChatAttachmentForm,
  ChatMessage,
  ChatSession,
  KnowledgeBase,
  KnowledgeDocument,
  SseEvent,
  SimilarQueryRecommendation,
} from '../types/rag.types';

const KNOWLEDGE_API_PREFIX = '/api/knowledge';
const CHAT_API_PREFIX = '/api/chat';

export class RagApi {
  // ═══════════════ 知识库 ═══════════════

  static createKnowledgeBase(data: { name: string; description?: string }) {
    return ApiClient.post<KnowledgeBase>(`${KNOWLEDGE_API_PREFIX}/base`, data);
  }

  static listKnowledgeBases() {
    return ApiClient.get<KnowledgeBase[]>(`${KNOWLEDGE_API_PREFIX}/base/list`);
  }

  static ingestAttachments(data: { knowledgeBaseId: number; attachments: AttachmentInput[] }) {
    return ApiClient.post<KnowledgeDocument[]>(`${KNOWLEDGE_API_PREFIX}/ingest`, data);
  }

  static getDocumentStatus(documentId: number) {
    return ApiClient.get<KnowledgeDocument>(`${KNOWLEDGE_API_PREFIX}/document/${documentId}`);
  }

  // ═══════════════ 聊天 ═══════════════

  static createSession(data?: { knowledgeBaseId?: number }) {
    return ApiClient.post<ChatSession>(`${CHAT_API_PREFIX}/session`, data ?? {});
  }

  static listSessions() {
    return ApiClient.get<ChatSession[]>(`${CHAT_API_PREFIX}/session/list`);
  }

  static getSessionMessages(sessionId: number) {
    return ApiClient.get<ChatMessage[]>(`${CHAT_API_PREFIX}/session/messages`, { sessionId });
  }

  static deleteSession(sessionId: number) {
    return ApiClient.delete<void>(`${CHAT_API_PREFIX}/session`, { sessionId });
  }

  static getSimilarQueries(query: string, topK?: number) {
    return ApiClient.post<SimilarQueryRecommendation[]>(`${CHAT_API_PREFIX}/similar-queries`, {
      query,
      topK,
    });
  }

  static summarizeSession(sessionId: number) {
    return ApiClient.post<string>(`${CHAT_API_PREFIX}/session/summarize`, { sessionId });
  }

  /**
   * 发送消息并接收 SSE 流式响应。
   * 返回 AbortController 用于取消请求。
   */
  static sendMessageStream(
    data: {
      sessionId: number;
      query: string;
      files?: ChatAttachmentForm[];
      regenerate?: boolean;
      lastUserId?: number;
    },
    callbacks: {
      onToken: (token: string) => void;
      onSources: (sources: SseEvent['content']) => void;
      onDone: () => void;
      onError: (message: string) => void;
    },
  ): AbortController {
    const controller = new AbortController();

    fetch(`${CHAT_API_PREFIX}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok || !response.body) {
          callbacks.onError('请求失败');
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6);
            try {
              const event = JSON.parse(jsonStr) as SseEvent;
              switch (event.type) {
                case 'token':
                  callbacks.onToken(event.content as string);
                  break;
                case 'sources':
                  callbacks.onSources(event.content);
                  break;
                case 'done':
                  callbacks.onDone();
                  break;
                case 'error':
                  callbacks.onError(event.content as string);
                  break;
              }
            } catch {
              // 忽略解析失败的行
            }
          }
        }
      })
      .catch((error) => {
        if (error instanceof Error && error.name !== 'AbortError') {
          callbacks.onError(error.message);
        }
      });

    return controller;
  }
}
