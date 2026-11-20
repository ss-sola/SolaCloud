import { describe, expect, vi, beforeEach } from 'vitest';
import { ChatSessionService } from '../../../src/modules/chat/service/chat-session.service';
import { ChatMessageService } from '../../../src/modules/chat/service/chat-message.service';
import { ChatSimilarQueryService } from '../../../src/modules/chat/service/chat-similar-query.service';
import { ChatSummaryService } from '../../../src/modules/chat/service/chat-summary.service';
import { DeepAgentService } from '../../../src/modules/chat/service/deep-agent.service';
import { KnowledgeBaseService } from '../../../src/modules/knowledge/service/knowledge-base.service';
import { ChatController } from '../../../src/modules/chat/controller/chat.controller';

describe('ChatController', () => {
  let controller: ChatController;

  beforeEach(() => {
    const chatSessionService: Partial<ChatSessionService> = {
      createSession: vi.fn(async (data) => ({ id: 1, ...data })),
      findByUserId: vi.fn(() => Promise.resolve([])),
      findByIdWithDeletedCheck: vi.fn(() => Promise.resolve(null)),
      delete: vi.fn(() => Promise.resolve()),
      updateTitle: vi.fn(() => Promise.resolve()),
    };

    const chatMessageService: Partial<ChatMessageService> = {
      findBySessionId: vi.fn(() => Promise.resolve([])),
      enrichSourcesFileInfo: vi.fn(() => Promise.resolve()),
    };

    const similarQueryService: Partial<ChatSimilarQueryService> = {
      findSimilar: vi.fn(() => Promise.resolve([])),
    };

    const summaryService: Partial<ChatSummaryService> = {
      summarizeSession: vi.fn(() => Promise.resolve('测试会话')),
    };

    const deepAgentService: Partial<DeepAgentService> = {
      streamChat: vi.fn(() =>
        (async function* () {
          yield { event: 'done', data: '{}' };
        })(),
      ),
    };

    const knowledgeBaseService: Partial<KnowledgeBaseService> = {
      listAccessible: vi.fn(() => Promise.resolve([])),
    };

    controller = new ChatController(
      chatSessionService as ChatSessionService,
      chatMessageService as ChatMessageService,
      similarQueryService as ChatSimilarQueryService,
      summaryService as ChatSummaryService,
      deepAgentService as DeepAgentService,
      knowledgeBaseService as KnowledgeBaseService,
    );

    expect(controller).toBeDefined();
  });
});
