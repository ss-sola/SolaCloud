import { ContextService } from '@nest-cloud/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { ChatSessionService } from '../../../src/modules/chat/service/chat-session.service';
import { ChatMessageService } from '../../../src/modules/chat/service/chat-message.service';
import { ChatSimilarQueryService } from '../../../src/modules/chat/service/chat-similar-query.service';
import { ChatSummaryService } from '../../../src/modules/chat/service/chat-summary.service';
import { DeepAgentService } from '../../../src/modules/chat/service/deep-agent.service';
import { KnowledgeBaseService } from '../../../src/modules/knowledge/service/knowledge-base.service';
import { ChatController } from '../../../src/modules/chat/controller/chat.controller';

describe('ChatController', () => {
  let controller: ChatController;
  const findOwnedSession = vi.fn();
  const deleteSession = vi.fn();
  const updateTitle = vi.fn();
  const findBySessionId = vi.fn();
  const summarizeSession = vi.fn();
  const streamChat = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    findOwnedSession.mockImplementation(async (id, owner) => (owner === 1 ? { id } : null));
    findBySessionId.mockResolvedValue([]);
    summarizeSession.mockResolvedValue('测试会话');
    streamChat.mockImplementation(async function* () {
      yield { event: 'done', data: '{}' };
    });
    const chatSessionService: Partial<ChatSessionService> = {
      createSession: vi.fn(async (data) => ({ id: 1, ...data })),
      findByUserId: vi.fn(() => Promise.resolve([])),
      findOwnedSession,
      delete: deleteSession,
      updateTitle,
    };

    const chatMessageService: Partial<ChatMessageService> = {
      findBySessionId,
      enrichSourcesFileInfo: vi.fn(() => Promise.resolve()),
    };

    const similarQueryService: Partial<ChatSimilarQueryService> = {
      findSimilar: vi.fn(() => Promise.resolve([])),
    };

    const summaryService: Partial<ChatSummaryService> = {
      summarizeSession,
    };

    const deepAgentService: Partial<DeepAgentService> = {
      streamChat,
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
  });

  afterEach(() => vi.restoreAllMocks());

  function setAccount(accountId?: number) {
    vi.spyOn(ContextService, 'getCurrentAccount').mockReturnValue(
      (accountId ? { accountId } : undefined) as ReturnType<
        typeof ContextService.getCurrentAccount
      >,
    );
  }

  it.each([undefined, 2])('拒绝没有会话归属权限的账号 %s', async (accountId) => {
    setAccount(accountId);
    const res = { setHeader: vi.fn(), flushHeaders: vi.fn() };
    const payload = { sessionId: 10 };
    const status = accountId ? 404 : 403;
    for (const result of await Promise.allSettled([
      controller.getSessionMessages(payload),
      controller.sendMessage({ ...payload, query: '测试' }, res as unknown as Response),
      controller.summarizeSession(payload),
      controller.deleteSession(payload),
    ])) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason.getStatus()).toBe(status);
    }
    expect(findBySessionId).not.toHaveBeenCalled();
    expect(res.flushHeaders).not.toHaveBeenCalled();
    expect(streamChat).not.toHaveBeenCalled();
    expect(summarizeSession).not.toHaveBeenCalled();
    expect(updateTitle).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('允许所有者读取、发送、摘要和删除', async () => {
    setAccount(1);
    const payload = { sessionId: 10 };
    const res = { setHeader: vi.fn(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn() };
    await controller.getSessionMessages(payload);
    await controller.sendMessage({ ...payload, query: '测试' }, res as unknown as Response);
    await controller.summarizeSession(payload);
    await controller.deleteSession(payload);
    expect(findOwnedSession).toHaveBeenCalledTimes(4);
    expect(findOwnedSession).toHaveBeenCalledWith(10, 1);
    expect(findBySessionId).toHaveBeenCalledWith(10);
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(streamChat).toHaveBeenCalled();
    expect(summarizeSession).toHaveBeenCalledWith(10);
    expect(updateTitle).toHaveBeenCalledWith(10, '测试会话');
    expect(deleteSession).toHaveBeenCalledWith(10);
  });
});
