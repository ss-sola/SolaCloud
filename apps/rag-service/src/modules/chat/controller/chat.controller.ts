import { ContextService, ProjectException, ResponseUtil } from '@nest-cloud/sdk';
import { Body, Controller, Delete, Get, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { SSE_EVENT_TYPE } from '../chat.constants';
import {
  CreateSessionForm,
  ChatSendForm,
  SessionMessagesForm,
  DeleteSessionForm,
  SimilarQueryForm,
  SummarizeSessionForm,
} from '../form/chat.form';
import { ChatSessionService } from '../service/chat-session.service';
import { ChatMessageService } from '../service/chat-message.service';
import { ChatSimilarQueryService } from '../service/chat-similar-query.service';
import { ChatSummaryService } from '../service/chat-summary.service';
import { DeepAgentService } from '../service/deep-agent.service';
import { KnowledgeBaseService } from '../../knowledge/service/knowledge-base.service';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatSessionService: ChatSessionService,
    private readonly chatMessageService: ChatMessageService,
    private readonly similarQueryService: ChatSimilarQueryService,
    private readonly summaryService: ChatSummaryService,
    private readonly deepAgentService: DeepAgentService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
  ) {}

  /** 创建聊天会话 */
  @Post('session')
  async createSession(@Body() form: CreateSessionForm) {
    const currentAccount = ContextService.getCurrentAccount();
    if (!currentAccount) {
      throw new ProjectException('请先登录');
    }
    const session = await this.chatSessionService.createSession({
      title: null,
      knowledgeBaseId: form.knowledgeBaseId ?? null,
      createUser: currentAccount.accountId,
      updateUser: currentAccount.accountId,
    });
    return ResponseUtil.success(session);
  }

  /** 获取会话列表 */
  @Get('session/list')
  async listSessions() {
    const currentAccount = ContextService.getCurrentAccount();
    if (!currentAccount) {
      throw new ProjectException('请先登录');
    }
    const list = await this.chatSessionService.findByUserId(currentAccount.accountId);
    return ResponseUtil.success(list);
  }

  /** 获取会话历史消息 */
  @Get('session/messages')
  async getSessionMessages(@Query() form: SessionMessagesForm) {
    const messages = await this.chatMessageService.findBySessionId(form.sessionId);
    await this.chatMessageService.enrichSourcesFileInfo(messages);
    return ResponseUtil.success(messages);
  }

  /** 删除聊天会话 */
  @Delete('session')
  async deleteSession(@Query() form: DeleteSessionForm) {
    const currentAccount = ContextService.getCurrentAccount();
    if (!currentAccount) {
      throw new ProjectException('请先登录');
    }
    const session = await this.chatSessionService.findByIdWithDeletedCheck(form.sessionId);
    if (!session) {
      throw new ProjectException('会话不存在');
    }
    if (session.createUser !== currentAccount.accountId) {
      throw new ProjectException('无权删除该会话');
    }
    await this.chatSessionService.delete(form.sessionId);
    return ResponseUtil.success(null);
  }

  /** SSE 流式聊天（Deep Agent） */
  @Post('send')
  async sendMessage(@Body() form: ChatSendForm, @Res() res: Response) {
    const currentAccount = ContextService.getCurrentAccount();
    if (!currentAccount) {
      throw new ProjectException('请先登录');
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      // 获取当前账号已授权的知识库 ID 集合
      const authorizedKbs = await this.knowledgeBaseService.listAccessible(
        currentAccount.accountId,
      );
      const authorizedKnowledgeBaseIds = new Set(authorizedKbs.map((kb) => kb.id));

      const eventStream = this.deepAgentService.streamChat(
        {
          sessionId: form.sessionId,
          query: form.query,
          files: form.files,
        },
        authorizedKnowledgeBaseIds,
      );

      for await (const event of eventStream) {
        const parsed = JSON.parse(event.data);

        switch (event.event) {
          case 'token':
            // Deep Agent 流式 token，实时输出给前端
            res.write(
              `data: ${JSON.stringify({ type: SSE_EVENT_TYPE.Token, content: parsed.token ?? '' })}\n\n`,
            );
            break;
          case 'sources':
            const sourcesData = (parsed.sources ?? []).map((s: Record<string, unknown>) => ({
              chunkId: s.chunk_id ?? s.chunkId,
              documentId: s.document_id ?? s.documentId,
              fileId: s.file_id ?? s.fileId ?? null,
              score: s.score,
            }));
            res.write(
              `data: ${JSON.stringify({ type: SSE_EVENT_TYPE.Sources, content: sourcesData })}\n\n`,
            );
            break;
          case 'subagent_start':
            // Deep Agent 内部子 Agent 事件，透传为自定义类型
            res.write(
              `data: ${JSON.stringify({
                type: 'subagent_start',
                content: { name: parsed.name },
              })}\n\n`,
            );
            break;
          case 'subagent_end':
            res.write(
              `data: ${JSON.stringify({
                type: 'subagent_end',
                content: { name: parsed.name, success: parsed.success },
              })}\n\n`,
            );
            break;
          case 'done':
            res.write(`data: ${JSON.stringify({ type: SSE_EVENT_TYPE.Done })}\n\n`);
            break;
          case 'error':
            res.write(
              `data: ${JSON.stringify({
                type: SSE_EVENT_TYPE.Error,
                content: parsed.message ?? '对话失败',
                code: parsed.code,
              })}\n\n`,
            );
            break;
        }

        // 强制 flush 数据到客户端，确保 SSE 实时性
        const writableStream = res as any;
        if (writableStream.flush) {
          writableStream.flush();
        } else {
          // 如果没有 compression 模块，用 setImmediate 让出事件循环
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '聊天失败';
      res.write(`data: ${JSON.stringify({ type: SSE_EVENT_TYPE.Error, content: message })}\n\n`);
    } finally {
      res.end();
    }
  }

  /** 获取相似历史问答推荐 */
  @Post('similar-queries')
  async getSimilarQueries(@Body() form: SimilarQueryForm) {
    const currentAccount = ContextService.getCurrentAccount();
    if (!currentAccount) {
      throw new ProjectException('请先登录');
    }
    const results = await this.similarQueryService.findSimilar({
      query: form.query,
      topK: form.topK ?? 3,
      createUsers: [currentAccount.accountId],
    });
    return ResponseUtil.success(results);
  }

  /** 手动生成会话摘要标题 */
  @Post('session/summarize')
  async summarizeSession(@Body() form: SummarizeSessionForm) {
    const summary = await this.summaryService.summarizeSession(form.sessionId);
    await this.chatSessionService.updateTitle(form.sessionId, summary);
    return ResponseUtil.success(summary);
  }
}
