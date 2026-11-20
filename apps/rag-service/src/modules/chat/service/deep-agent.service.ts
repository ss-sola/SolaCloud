import { ContextService, ProjectException } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import type { DeepAgent, DeepAgentRunStream } from 'deepagents';
import { CHAT_ROLE } from '../chat.constants';
import { RagConfigService } from '../../config/service/rag-config.service';
import { ChatRagToolService } from './chat-rag-tool.service';
import { ChatAttachmentToolService } from './chat-attachment-tool.service';
import { DeepAgentRuntimeService } from './deep-agent-runtime.service';
import { ChatSessionService } from './chat-session.service';
import { ChatMessageService } from './chat-message.service';
import { ChatAttachmentForm } from '../form/chat.form';
import {
  DEEP_AGENT_ERROR_CODE_INTERNAL,
  DEEP_AGENT_ERROR_CODE_MODEL_UNAVAILABLE,
  DEEP_AGENT_ERROR_CODE_RETRIEVAL_FAILED,
  DEEP_AGENT_ERROR_CODE_STREAM_CANCELLED,
  DEEP_AGENT_ERROR_CODE_WORKSPACE_NOT_FOUND,
  DEEP_AGENT_ERROR_CODE_SESSION_NOT_FOUND,
  DEEP_AGENT_ERROR_CODE_CONTEXT_LIMIT_EXCEEDED,
  DEEP_AGENT_ERROR_TIMEOUT,
} from '../chat.constants';

/** Agent 请求上下文 */
export interface AgentRequestContext {
  accountId: number;
  sessionId: number;
  threadId: string;
  workspaceId: string;
  runId?: string | null;
  authorizedKnowledgeBaseIds: Set<number>;
  sessionKnowledgeBaseId: number | null;
  /** 聊天附件（可选，用于注入 file_reader Tool） */
  fileAttachments?: ChatAttachmentForm[];
  abortSignal: AbortSignal;
}

/** Agent 运行结果聚合 */
export interface AgentRunResult {
  /** 最终文本答案 */
  answer: string;
  /** 检索来源列表 */
  sources: Array<{
    chunkId: number;
    documentId: number;
    fileId: number | null;
    score: number;
  }>;
  /** Token 用量统计 */
  usage: Record<string, number>;
  /** Deep Agent run ID */
  runId: string | null;
  /** 模型调用次数 */
  modelCallCount: number;
  /** Tool 调用次数 */
  toolCallCount: number;
  /** 子 Agent 调用次数 */
  subAgentCallCount: number;
  /** 子 Agent 运行结果摘要 */
  subAgentSummaries: Array<{ name: string; success: boolean; content?: string }>;
  /** 是否有中间工具调用 */
  hasIntermediateSteps: boolean;
}

/** SSE 事件输出格式 */
export interface SseEventOutput {
  event: string;
  data: string;
}

/** 标准化错误码 */
export type DeepAgentErrorCode =
  | typeof DEEP_AGENT_ERROR_CODE_INTERNAL
  | typeof DEEP_AGENT_ERROR_CODE_MODEL_UNAVAILABLE
  | typeof DEEP_AGENT_ERROR_CODE_RETRIEVAL_FAILED
  | typeof DEEP_AGENT_ERROR_CODE_STREAM_CANCELLED
  | typeof DEEP_AGENT_ERROR_CODE_WORKSPACE_NOT_FOUND
  | typeof DEEP_AGENT_ERROR_CODE_SESSION_NOT_FOUND
  | typeof DEEP_AGENT_ERROR_CODE_CONTEXT_LIMIT_EXCEEDED
  | typeof DEEP_AGENT_ERROR_TIMEOUT;

/** 流式请求入参 */
export interface StreamChatRequest {
  sessionId: number;
  query: string;
  /** 聊天附件 */
  files?: ChatAttachmentForm[];
  regenerate?: boolean;
  lastUserId?: number;
}

/** Agent 内部状态（流式/同步共享） */
interface AgentInternalState {
  answerBuilder: string;
  sources: Array<{
    chunkId: number;
    documentId: number;
    fileId: number | null;
    score: number;
  }>;
  usage: Record<string, number>;
  modelCallCount: number;
  toolCallCount: number;
  subAgentCallCount: number;
  subAgentSummaries: Array<{ name: string; success: boolean; content?: string }>;
  isFinalAnswerEmitted: boolean;
}

/**
 * Deep Agent 业务编排服务。
 *
 * 职责：
 * - 通过 createDeepAgent 注入统一模型、RAG Tool、隔离 backend、checkpointer 和 store
 * - 保持默认规划、filesystem、execute、通用子 Agent、自动摘要及必要中间件启用
 * - 为每次请求绑定 thread、store namespace、workspace、业务授权上下文和取消信号
 * - 适配 streamEvents，区分最终主 Agent 回答与中间事件
 * - 缓冲可能继续 Tool Call 的模型轮次，仅确认终态后输出 token
 * - 聚合来源、usage、模型/Tool/子 Agent 次数和运行结果
 * - 对外异常统一归一化为稳定错误码
 * - 不包含任何直接 LLM、旧 RAG 链或独立 LangGraph fallback
 */
@Injectable()
export class DeepAgentService {
  private readonly logger = new Logger(DeepAgentService.name);

  /** 预编译的 Agent 实例（单例，避免重复创建） */
  private agent: DeepAgent | null = null;

  /** Agent 创建锁（异步懒加载保护） */
  private agentInitializing: Promise<void> | null = null;

  /** 累计检索计数器（跨子 Agent 调用共享） */
  private cumulativeCountRef = { count: 0 };

  constructor(
    private readonly ragConfigService: RagConfigService,
    private readonly chatRagToolService: ChatRagToolService,
    private readonly chatAttachmentToolService: ChatAttachmentToolService,
    private readonly deepAgentRuntimeService: DeepAgentRuntimeService,
    private readonly chatSessionService: ChatSessionService,
    private readonly chatMessageService: ChatMessageService,
  ) {}

  // ---------------------------------------------------------------------------
  // 公开方法
  // ---------------------------------------------------------------------------

  /**
   * 流式对话：通过 Deep Agent 执行 RAG 增强对话并返回 SSE 事件流。
   *
   * @param request - 流式请求参数
   * @param authorizedKnowledgeBaseIds - 当前账号已授权的知识库 ID 集合
   * @returns SSE 事件异步迭代器
   */
  async *streamChat(
    request: StreamChatRequest,
    authorizedKnowledgeBaseIds: Set<number>,
  ): AsyncIterable<SseEventOutput> {
    let context: AgentRequestContext | null = null;
    let runId: string | null = null;
    let aggregatedState: AgentInternalState | null = null;
    let savedUserMessageId: number | null = null;

    try {
      // 1. 验证会话存在
      await this.validateSession(request.sessionId);

      // 2. 获取或创建工作区并绑定 thread
      const workspace = await this.deepAgentRuntimeService.getOrCreateWorkspace({
        accountId: ContextService.getCurrentAccount()?.accountId ?? 0,
        sessionId: request.sessionId,
      });
      const threadId = workspace.threadId || this.generateThreadId();
      if (!workspace.threadId) {
        workspace.threadId = threadId;
        await this.deepAgentRuntimeService.updateWorkspaceThreadId(workspace.workspaceId, threadId);
      }

      const session = await this.chatSessionService.findOne(request.sessionId);

      context = {
        accountId: workspace.accountId,
        sessionId: request.sessionId,
        threadId,
        workspaceId: workspace.workspaceId,
        authorizedKnowledgeBaseIds,
        sessionKnowledgeBaseId: session?.knowledgeBaseId ?? null,
        fileAttachments: request.files,
        abortSignal: new AbortController().signal,
      };

      // 3. 确保 Agent 已初始化
      await this.ensureAgentInitialized(context);

      // 4. 创建取消信号并执行流式事件
      const controller = new AbortController();
      context.abortSignal = controller.signal;

      // 5. 执行流式事件并逐事件产出，同时捕获 runId
      // 将所有附件 URL 以 JSON 数组形式拼入 query，多媒体附件需引导 Agent 调用 file_reader 工具
      const fileAttachments = request.files ?? [];
      let enrichedQuery: string;

      if (fileAttachments.length > 0) {
        const attachmentInfo = fileAttachments.map((f) => ({
          name: f.originalName,
          url: f.fileUrl,
          mimeType: f.mimeType,
        }));
        const fileList = JSON.stringify(attachmentInfo);
        enrichedQuery =
          `用户附带了以下附件：${fileList}。` +
          `其中图片、音频、视频等多媒体文件需要使用 file_reader 工具读取内容。` +
          `用户消息: ${request.query}`;
      } else {
        enrichedQuery = request.query;
      }
      yield* this.executeWithStreamEvents(
        context,
        enrichedQuery,
        controller,
        authorizedKnowledgeBaseIds,
        (rid: string | null) => {
          runId = rid;
        },
        (state: AgentInternalState) => {
          aggregatedState = state;
        },
      );
    } catch (error) {
      yield this.normalizeErrorToSseEvent(error, context);
    } finally {
      // 6. 消息持久化：流结束后统一保存用户消息和助手消息
      this.logger.log(
        `streamChat finally: aggregatedState=${!!aggregatedState}, answerLen=${(aggregatedState as AgentInternalState | null)?.answerBuilder?.length ?? 0}`,
      );
      const state = aggregatedState as AgentInternalState | null;
      if (state && state.isFinalAnswerEmitted && state.answerBuilder) {
        try {
          const currentAccountId = ContextService.getCurrentAccount()?.accountId ?? null;

          // 保存用户消息（仅在非重新生成时）
          if (!request.regenerate) {
            const userMsg = await this.chatMessageService.saveMessage({
              sessionId: request.sessionId,
              role: CHAT_ROLE.User,
              content: request.query,
              attachments:
                request.files?.map((f) => ({
                  fileId: f.fileId,
                  originalName: f.originalName,
                  mimeType: f.mimeType,
                  size: f.size,
                  fileUrl: f.fileUrl,
                })) ?? null,
              createUser: currentAccountId,
            });
            savedUserMessageId = userMsg.id;
          }

          // 保存助手消息
          const deduplicatedSources = this.deduplicateSources(state.sources);
          await this.chatMessageService.saveMessage({
            sessionId: request.sessionId,
            role: CHAT_ROLE.Assistant,
            content: state.answerBuilder,
            sources: deduplicatedSources.map((s) => ({
              chunkId: s.chunkId,
              documentId: s.documentId,
              fileId: s.fileId,
              score: s.score,
            })),
            tokenUsage: Object.keys(state.usage).length > 0 ? state.usage : null,
            createUser: currentAccountId,
          });

          this.logger.log(
            `消息持久化完成: sessionId=${request.sessionId}, userMsgId=${savedUserMessageId}, answerLength=${state.answerBuilder.length}`,
          );
        } catch (saveErr) {
          this.logger.error(
            `消息持久化失败: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
          );
          // 持久化失败不影响 SSE 流结束，消息已在 finally 之前 yield 完毕
        }
      }

      // 7. 标记工作区完成或取消
      if (context?.workspaceId) {
        // 如果请求被取消，先标记 workspace 为 cancelled
        if (context.abortSignal.aborted) {
          await this.deepAgentRuntimeService
            .cancelWorkspace(context.workspaceId)
            .catch((err) =>
              this.logger.warn(`标记工作区取消失败: ${err instanceof Error ? err.message : err}`),
            );
        } else {
          await this.deepAgentRuntimeService
            .markWorkspaceCompleted(context.workspaceId)
            .catch((err) =>
              this.logger.warn(`标记工作区完成失败: ${err instanceof Error ? err.message : err}`),
            );
        }

        // 8. 更新 workspace 的 runId 用于追踪
        if (runId) {
          await this.deepAgentRuntimeService
            .updateWorkspaceRunId(context.workspaceId, runId)
            .catch((err) =>
              this.logger.warn(
                `更新 workspace runId 失败: ${err instanceof Error ? err.message : err}`,
              ),
            );
        }
      }
    }
  }

  /**
   * 同步对话：通过 Deep Agent 执行 RAG 增强对话并返回完整结果。
   *
   * @param request - 对话请求参数
   * @param authorizedKnowledgeBaseIds - 当前账号已授权的知识库 ID 集合
   * @returns Agent 运行结果聚合
   */
  async chat(
    request: StreamChatRequest,
    authorizedKnowledgeBaseIds: Set<number>,
  ): Promise<AgentRunResult> {
    let context: AgentRequestContext | null = null;
    let runId: string | null = null;
    let savedUserMessageId: number | null = null;
    let chatResult: AgentRunResult | null = null;

    try {
      await this.validateSession(request.sessionId);

      const workspace = await this.deepAgentRuntimeService.getOrCreateWorkspace({
        accountId: ContextService.getCurrentAccount()?.accountId ?? 0,
        sessionId: request.sessionId,
      });
      const threadId = workspace.threadId || this.generateThreadId();
      if (!workspace.threadId) {
        workspace.threadId = threadId;
        await this.deepAgentRuntimeService.updateWorkspaceThreadId(workspace.workspaceId, threadId);
      }

      const session = await this.chatSessionService.findOne(request.sessionId);

      context = {
        accountId: workspace.accountId,
        sessionId: request.sessionId,
        threadId,
        workspaceId: workspace.workspaceId,
        authorizedKnowledgeBaseIds,
        sessionKnowledgeBaseId: session?.knowledgeBaseId ?? null,
        fileAttachments: request.files,
        abortSignal: new AbortController().signal,
      };

      await this.ensureAgentInitialized(context);

      const controller = new AbortController();
      context.abortSignal = controller.signal;

      chatResult = await this.executeWithBuffering(
        context,
        request.query,
        controller,
        authorizedKnowledgeBaseIds,
        (rid: string | null) => {
          runId = rid;
        },
      );
      return chatResult;
    } catch (error) {
      throw this.normalizeError(error, context);
    } finally {
      // 消息持久化：同步对话在 executeWithBuffering 返回后立即保存
      try {
        if (chatResult) {
          const currentAccountId = ContextService.getCurrentAccount()?.accountId ?? null;

          // 保存用户消息（仅在非重新生成时）
          if (!request.regenerate) {
            const userMsg = await this.chatMessageService.saveMessage({
              sessionId: request.sessionId,
              role: CHAT_ROLE.User,
              content: request.query,
              attachments:
                request.files?.map((f) => ({
                  fileId: f.fileId,
                  originalName: f.originalName,
                  mimeType: f.mimeType,
                  size: f.size,
                  fileUrl: f.fileUrl,
                })) ?? null,
              createUser: currentAccountId,
            });
            savedUserMessageId = userMsg.id;
          }

          // 保存助手消息
          const deduplicatedSources = this.deduplicateSources(chatResult.sources);
          await this.chatMessageService.saveMessage({
            sessionId: request.sessionId,
            role: CHAT_ROLE.Assistant,
            content: chatResult.answer,
            sources: deduplicatedSources.map((s) => ({
              chunkId: s.chunkId,
              documentId: s.documentId,
              fileId: s.fileId,
              score: s.score,
            })),
            tokenUsage: Object.keys(chatResult.usage).length > 0 ? chatResult.usage : null,
            createUser: currentAccountId,
          });

          this.logger.log(
            `消息持久化完成: sessionId=${request.sessionId}, ` +
              `userMsgId=${savedUserMessageId}, answerLength=${chatResult.answer.length}`,
          );
        }
        // 没有结果说明走的是 catch 分支（throw normalizeError），跳过持久化
      } catch (saveErr) {
        this.logger.error(
          `消息持久化失败: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
        );
      }

      // 标记工作区完成或取消
      if (context?.workspaceId) {
        if (context.abortSignal.aborted) {
          await this.deepAgentRuntimeService
            .cancelWorkspace(context.workspaceId)
            .catch((err) =>
              this.logger.warn(`标记工作区取消失败: ${err instanceof Error ? err.message : err}`),
            );
        } else {
          await this.deepAgentRuntimeService
            .markWorkspaceCompleted(context.workspaceId)
            .catch((err) =>
              this.logger.warn(`标记工作区完成失败: ${err instanceof Error ? err.message : err}`),
            );
        }

        if (runId) {
          await this.deepAgentRuntimeService
            .updateWorkspaceRunId(context.workspaceId, runId)
            .catch((err) =>
              this.logger.warn(
                `更新 workspace runId 失败: ${err instanceof Error ? err.message : err}`,
              ),
            );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Agent 初始化
  // ---------------------------------------------------------------------------

  /**
   * 确保 Agent 实例已初始化。使用单例模式避免每次请求重建 Agent。
   */
  private async ensureAgentInitialized(context: AgentRequestContext): Promise<void> {
    if (this.agent) {
      return;
    }

    if (this.agentInitializing) {
      await this.agentInitializing;
      return;
    }

    this.agentInitializing = this.initializeAgent(context).finally(() => {
      this.agentInitializing = null;
    });

    await this.agentInitializing;
  }

  /**
   * 创建 Deep Agent 实例。
   *
   * 注入：
   * - 统一模型（从 RagConfigService 获取配置）
   * - RAG Tool（通过 ChatRagToolService 创建）
   * - 隔离 backend（StateBackend）
   * - Checkpointer（PostgreSQL 或 MemorySaver fallback）
   * - Store（PostgreSQL 或 InMemoryStore fallback）
   *
   * 默认启用：规划、filesystem、execute、通用子 Agent、自动摘要
   */
  private async initializeAgent(context: AgentRequestContext): Promise<void> {
    try {
      const { createDeepAgent, StateBackend, GENERAL_PURPOSE_SUBAGENT } =
        await import('deepagents');

      // 1. 获取模型配置
      const chatLlmConfig = await this.ragConfigService.getChatLlmConfig();

      if (!chatLlmConfig.apiKey) {
        throw new ProjectException(
          `${DEEP_AGENT_ERROR_CODE_MODEL_UNAVAILABLE}: LLM 模型配置不完整，缺少 API Key`,
          500,
        );
      }

      // 2. 创建统一模型实例
      const model = await this.createUnifiedModel(chatLlmConfig);

      // 3. 创建 RAG Tool
      const ragTool = this.chatRagToolService.createTool(this.cumulativeCountRef);

      // 4. 创建文件读取 Tool（有附件时注入）
      const tools: unknown[] = [ragTool];
      const fileReaderTool = this.chatAttachmentToolService.createTool();
      tools.push(fileReaderTool);

      // 5. 创建 StateBackend
      const stateBackend = new StateBackend();

      // 6. 创建 Checkpointer（支持中断/恢复，PostgreSQL 或 MemorySaver fallback）
      const { checkpointer, store } = await this.createCheckpointerAndStore();

      // 8. 创建 Agent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deepAgent: DeepAgent = await createDeepAgent({
        model,
        tools: tools as any,
        subagents: [GENERAL_PURPOSE_SUBAGENT],
        checkpointer,
        store,
        backend: stateBackend,
        name: 'rag-chat-agent',
        // createDeepAgent 默认启用：规划、filesystem、execute、通用子 Agent、自动摘要
      } as any);

      this.agent = deepAgent;
      this.logger.log(
        `Deep Agent 初始化成功: model=${chatLlmConfig.model}, ` +
          `thread=${context.threadId}, workspace=${context.workspaceId}`,
      );
    } catch (error) {
      this.agentInitializing = null;
      this.logger.error(
        `Deep Agent 初始化失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw this.normalizeError(error, context);
    }
  }

  /**
   * 创建统一模型实例。
   * 复用 ChatLlmService 中相同的模型创建逻辑，但不依赖旧 RAG 链。
   */
  private async createUnifiedModel(config: {
    model: string;
    baseUrl: string;
    apiKey: string;
  }): Promise<any> {
    const { ChatOpenAI } = await import('@langchain/openai');
    const { DEFAULT_LLM_TIMEOUT } = await import('../../../constants/rag.constants');

    return new ChatOpenAI({
      modelName: config.model,
      apiKey: config.apiKey,
      streaming: true,
      timeout: DEFAULT_LLM_TIMEOUT,
      configuration: { baseURL: config.baseUrl, apiKey: config.apiKey },
    });
  }

  // ---------------------------------------------------------------------------
  // streamEvents 执行与事件分类
  // ---------------------------------------------------------------------------

  /**
   * 执行 streamEvents 并逐事件产出 SSE 格式输出。
   *
   * v3 事件流使用投影（projection）模式：
   * - run.messages → ChatModelStreamHandle，每个 handle 内含 .text（增量文本）、.toolCalls、.reasoning、.usage
   * - run.values → 状态快照快照（含工具调用结果、子 agent 输出）
   * - run.lifecycle → 生命周期事件（started, node_start, node_end, finished）
   * - run.subgraphs → 子图流
   * - run.output → 最终状态 Promise
   *
   * 旧版 on_chat_model_stream / on_llm_stream 事件在 v3 中不再出现。
   *
   * @param onRunIdChanged - runId 变更回调，用于将 runId 回传给调用方
   */
  private async *executeWithStreamEvents(
    context: AgentRequestContext,
    query: string,
    controller: AbortController,
    authorizedKnowledgeBaseIds: Set<number>,
    _onRunIdChanged?: (runId: string | null) => void,
    onStateAggregated?: (state: AgentInternalState) => void,
  ): AsyncIterable<SseEventOutput> {
    // 重置累计检索计数器
    this.cumulativeCountRef = { count: 0 };

    if (!this.agent) {
      throw new ProjectException(
        `${DEEP_AGENT_ERROR_CODE_MODEL_UNAVAILABLE}: Agent 未初始化，请先调用 ensureAgentInitialized`,
      );
    }

    const internalState: AgentInternalState = {
      answerBuilder: '',
      sources: [],
      usage: {},
      modelCallCount: 0,
      toolCallCount: 0,
      subAgentCallCount: 0,
      subAgentSummaries: [],
      isFinalAnswerEmitted: false,
    };

    // 不再使用 token buffer，改用 values 增量方式

    try {
      // 使用 v3 版本的 streamEvents
      const runStream: DeepAgentRunStream = await this.agent.streamEvents(
        {
          messages: [new HumanMessage(query)],
        },
        {
          version: 'v3' as const,
          configurable: { thread_id: context.threadId },
          signal: controller.signal,
        },
      );

      // 使用 runStream.messages 投影获取逐 token 增量
      // 每条 message 是 ChatModelStream，.text 是 TextContentStream（yield incremental text deltas）
      for await (const ev of this.consumeMessageTokens(
        runStream,
        internalState,
        controller.signal,
      )) {
        yield ev;
      }

      // 流结束：消息已累积完毕，标记为最终答案已产出
      internalState.isFinalAnswerEmitted = true;

      // 流结束：发出完成事件
      yield {
        event: 'done',
        data: JSON.stringify({
          usage: internalState.usage,
          modelCallCount: internalState.modelCallCount,
          toolCallCount: internalState.toolCallCount,
          subAgentCallCount: internalState.subAgentCallCount,
          subAgentSummaries: internalState.subAgentSummaries,
          hasIntermediateSteps: internalState.toolCallCount > 0,
        }),
      };

      // 流结束：将聚合状态回传给调用方，供消息持久化使用
      onStateAggregated?.(internalState);
    } catch (error) {
      // 流中断时也标记为已产出，允许保存已生成的部分答案
      internalState.isFinalAnswerEmitted = true;

      if (controller.signal.aborted) {
        yield {
          event: 'error',
          data: JSON.stringify({
            code: DEEP_AGENT_ERROR_CODE_STREAM_CANCELLED,
            message: '对话已取消',
          }),
        };
      } else {
        yield {
          event: 'error',
          data: JSON.stringify({
            code: this.classifyErrorCode(error),
            message: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 缓冲模式执行（同步对话）
  // ---------------------------------------------------------------------------

  /**
   * 执行 Agent 调用并缓冲所有中间轮次，仅在确认终态后返回聚合结果。
   * 适用于非流式同步对话场景。
   *
   * v3 事件流使用投影（projection）模式，通过 values 和 lifecycle 事件
   * 获取最终答案。
   *
   * @param onRunIdChanged - runId 变更回调
   */
  private async executeWithBuffering(
    context: AgentRequestContext,
    query: string,
    controller: AbortController,
    authorizedKnowledgeBaseIds: Set<number>,
    onRunIdChanged?: (runId: string | null) => void,
  ): Promise<AgentRunResult> {
    const internalState: AgentInternalState = {
      answerBuilder: '',
      sources: [],
      usage: {},
      modelCallCount: 0,
      toolCallCount: 0,
      subAgentCallCount: 0,
      subAgentSummaries: [],
      isFinalAnswerEmitted: false,
    };

    // 重置累计检索计数器
    this.cumulativeCountRef = { count: 0 };

    try {
      let capturedRunId: string | null = null;

      if (!this.agent) {
        throw new ProjectException(`${DEEP_AGENT_ERROR_CODE_MODEL_UNAVAILABLE}: Agent 未初始化`);
      }

      // 使用 streamEvents 收集所有事件
      const runStream: DeepAgentRunStream = await this.agent.streamEvents(
        {
          messages: [new HumanMessage(query)],
        },
        {
          version: 'v3' as const,
          configurable: { thread_id: context.threadId },
          signal: controller.signal,
        },
      );

      let runIdCaptured = false;

      // 同时注册回调，将 runId 保存到局部变量
      const localOnRunIdChanged: (rid: string | null) => void = (rid: string | null) => {
        capturedRunId = rid;
        onRunIdChanged?.(rid);
      };

      for await (const rawEvent of runStream) {
        const event = rawEvent as unknown as {
          method: string;
          params: { data: unknown; metadata?: Record<string, unknown> };
        };
        const eventName = event.method;
        const data = event.params.data;

        // 从 streamEvents 的 metadata 中提取 run_id
        if (!runIdCaptured && event.params.metadata?.run_id) {
          localOnRunIdChanged(String(event.params.metadata.run_id));
          runIdCaptured = true;
        }

        // lifecycle 事件
        if (eventName === 'lifecycle') {
          const lifecycleData = data as Record<string, unknown>;
          const status = lifecycleData?.status as string;
          if (status === 'finished') {
            internalState.isFinalAnswerEmitted = true;
          }
          continue;
        }

        // values 事件：状态快照
        if (eventName === 'values') {
          const valuesData = data as Record<string, unknown>;
          // 检测工具调用
          if (valuesData?.updates) {
            const updates = valuesData.updates as Record<string, unknown>[];
            for (const update of updates) {
              for (const [_key, nodeData] of Object.entries(update as Record<string, unknown>)) {
                if (nodeData && typeof nodeData === 'object') {
                  const nodeObj = nodeData as Record<string, unknown>;
                  if (nodeObj?.events) {
                    const events = nodeObj.events as Array<Record<string, unknown>>;
                    for (const evt of events) {
                      const eventType = evt?.type as string;
                      if (eventType === 'tool_start') {
                        internalState.toolCallCount++;
                      }
                      if (eventType === 'tool_end') {
                        const evtData = evt?.data as Record<string, unknown> | undefined;
                        const toolName = (evtData?.name as string) || '';
                        if (toolName === 'rag_retrieve') {
                          const output = this.parseToolOutput(evtData?.output);
                          if (output?.success && output?.sources) {
                            const sourceList = output.sources as Array<{
                              chunkId: number;
                              documentId: number;
                              fileId: number | null;
                              score: number;
                            }>;
                            internalState.sources.push(...sourceList);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          // 检测 AI 消息（最终答案）
          if (valuesData?.messages && Array.isArray(valuesData.messages)) {
            const messages = valuesData.messages as Array<Record<string, unknown>>;
            const lastMsg = messages[messages.length - 1];
            if (lastMsg) {
              const msgType = lastMsg?.type as string;
              // 兼容 'ai' 和 'assistant' 两种消息类型
              if (msgType === 'ai' || msgType === 'assistant') {
                const content = this.extractMessageContent(lastMsg);
                if (content && !internalState.isFinalAnswerEmitted) {
                  internalState.answerBuilder = content;
                  internalState.isFinalAnswerEmitted = true;
                }
              }
            }
          }
          continue;
        }

        // tasks 事件：子 agent
        if (eventName === 'tasks') {
          const taskData = data as Record<string, unknown>;
          const taskStatus = taskData?.status as string;
          const taskName = (taskData?.name as string) || 'unnamed';

          if (taskStatus === 'started') {
            internalState.subAgentCallCount++;
          } else if (taskStatus === 'finished') {
            const success = !taskData?.error;
            internalState.subAgentSummaries.push({
              name: taskName,
              success,
              content: success ? this.extractSubAgentContent(taskData) : undefined,
            });
          }
          continue;
        }

        // errors
        if (eventName === 'errors') {
          const errData = data as Record<string, unknown>;
          const errMsg = errData?.error as string;
          throw new Error(typeof errMsg === 'string' ? errMsg : String(errMsg));
        }
      }

      return {
        answer: internalState.answerBuilder,
        sources: internalState.sources,
        usage: internalState.usage,
        runId: capturedRunId,
        modelCallCount: internalState.modelCallCount,
        toolCallCount: internalState.toolCallCount,
        subAgentCallCount: internalState.subAgentCallCount,
        subAgentSummaries: internalState.subAgentSummaries,
        hasIntermediateSteps: internalState.toolCallCount > 0,
      };
    } catch (error) {
      throw this.normalizeError(error, context);
    }
  }

  // ---------------------------------------------------------------------------
  // 事件数据提取辅助
  // ---------------------------------------------------------------------------

  /** 从 LLM 事件数据中提取文本内容 */
  private extractLlmContent(data: unknown): string {
    if (!data || typeof data !== 'object') return '';
    const obj = data as Record<string, unknown>;
    const message = obj.message;
    if (message && typeof message === 'object') {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content.filter((c) => typeof c === 'string').join('');
      }
    }
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.chunk === 'string') return obj.chunk;
    return '';
  }

  /** 从消息对象中提取文本内容（v3 事件格式） */
  private extractMessageContent(msg: Record<string, unknown>): string {
    const content = msg.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((c) => {
          if (typeof c === 'string') return c;
          if (c && typeof c === 'object' && 'text' in c) {
            return (c as Record<string, unknown>).text as string;
          }
          return '';
        })
        .join('');
    }
    return '';
  }

  /** 解析 Tool 输出为结构化对象 */
  private parseToolOutput(output: unknown): Record<string, unknown> | null {
    if (!output) return null;
    if (typeof output === 'string') {
      try {
        return JSON.parse(output);
      } catch {
        return { raw: output };
      }
    }
    if (typeof output === 'object') return output as Record<string, unknown>;
    return null;
  }

  /** 提取子 Agent 结果内容 */
  private extractSubAgentContent(data: unknown): string {
    if (!data || typeof data !== 'object') return '';
    const obj = data as Record<string, unknown>;
    const output = obj.output;
    if (output && typeof output === 'object') {
      const messages = (output as Record<string, unknown>).messages;
      if (Array.isArray(messages) && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && typeof lastMsg === 'object') {
          const content = (lastMsg as Record<string, unknown>).content;
          if (typeof content === 'string') return content;
        }
      }
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // 错误处理与归一化
  // ---------------------------------------------------------------------------

  /**
   * 将内部异常归一化为稳定的错误码。
   * ProjectException(msg, statusCode) 构造函数不接受自定义错误码字段，
   * 因此将错误码嵌入消息中以便 classifyErrorCode 解析。
   */
  private normalizeError(error: unknown, _context: AgentRequestContext | null): ProjectException {
    const code = this.classifyErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);
    return new ProjectException(`${code}: ${message}`, 500);
  }

  /**
   * 将异常转换为 SSE 错误事件输出。
   */
  private normalizeErrorToSseEvent(
    error: unknown,
    _context: AgentRequestContext | null,
  ): SseEventOutput {
    const code = this.classifyErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);
    return {
      event: 'error',
      data: JSON.stringify({ code, message }),
    };
  }

  /**
   * 根据异常类型分类错误码。
   */
  private classifyErrorCode(error: unknown): DeepAgentErrorCode {
    // ProjectException 消息中可能包含前缀错误码
    if (error instanceof ProjectException) {
      const resp = error.getResponse() as Record<string, unknown>;
      const msg = typeof resp.message === 'string' ? resp.message : error.message;
      const codeMatch = msg.match(/^(DEEP_AGENT_[A-Z_]+):/);
      if (codeMatch) {
        const matched = codeMatch[1] as DeepAgentErrorCode;
        if (
          matched === DEEP_AGENT_ERROR_CODE_INTERNAL ||
          matched === DEEP_AGENT_ERROR_CODE_MODEL_UNAVAILABLE ||
          matched === DEEP_AGENT_ERROR_CODE_RETRIEVAL_FAILED ||
          matched === DEEP_AGENT_ERROR_CODE_STREAM_CANCELLED ||
          matched === DEEP_AGENT_ERROR_CODE_WORKSPACE_NOT_FOUND ||
          matched === DEEP_AGENT_ERROR_CODE_SESSION_NOT_FOUND ||
          matched === DEEP_AGENT_ERROR_CODE_CONTEXT_LIMIT_EXCEEDED ||
          matched === DEEP_AGENT_ERROR_TIMEOUT
        ) {
          return matched;
        }
      }
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      return DEEP_AGENT_ERROR_CODE_STREAM_CANCELLED;
    }

    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes('API Key') ||
      message.includes('apiKey') ||
      message.includes('authentication')
    ) {
      return DEEP_AGENT_ERROR_CODE_MODEL_UNAVAILABLE;
    }

    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return DEEP_AGENT_ERROR_TIMEOUT;
    }

    if (message.includes('context') || message.includes('token') || message.includes('limit')) {
      return DEEP_AGENT_ERROR_CODE_CONTEXT_LIMIT_EXCEEDED;
    }

    if (message.includes('workspace') || message.includes('Workspace')) {
      return DEEP_AGENT_ERROR_CODE_WORKSPACE_NOT_FOUND;
    }

    if (message.includes('session') || message.includes('Session')) {
      return DEEP_AGENT_ERROR_CODE_SESSION_NOT_FOUND;
    }

    if (message.includes('retrieve') || message.includes('retrieval') || message.includes('检索')) {
      return DEEP_AGENT_ERROR_CODE_RETRIEVAL_FAILED;
    }

    return DEEP_AGENT_ERROR_CODE_INTERNAL;
  }

  // ---------------------------------------------------------------------------
  // 辅助方法
  // ---------------------------------------------------------------------------

  /**
   * 消费 runStream 的 ProtocolEvent 迭代器。
   * 负责提取 sources、subagent、lifecycle 等元信息。
   */
  private async consumeProtocolEvents(
    runStream: DeepAgentRunStream,
    internalState: AgentInternalState,
    controller: AbortController,
    _onRunIdChanged?: (runId: string | null) => void,
  ): Promise<void> {
    try {
      for await (const rawEvent of runStream) {
        if (controller.signal.aborted) return;

        const event = rawEvent as unknown as {
          method: string;
          params: { data: unknown; metadata?: Record<string, unknown> };
        };
        const eventName = event.method;
        const data = event.params.data;

        // lifecycle 事件
        if (eventName === 'lifecycle') {
          const lifecycleData = data as Record<string, unknown>;
          const status = lifecycleData?.status as string;
          if (status === 'finished') {
            internalState.isFinalAnswerEmitted = true;
          }
          continue;
        }

        // values 事件：状态快照（包含工具调用结果）
        if (eventName === 'values') {
          const valuesData = data as Record<string, unknown>;
          if (valuesData?.updates) {
            const updates = valuesData.updates as Record<string, unknown>[];
            for (const update of updates) {
              for (const [_key, nodeData] of Object.entries(update as Record<string, unknown>)) {
                if (nodeData && typeof nodeData === 'object') {
                  const nodeObj = nodeData as Record<string, unknown>;
                  if (nodeObj?.events) {
                    const events = nodeObj.events as Array<Record<string, unknown>>;
                    for (const evt of events) {
                      const eventType = evt?.type as string;
                      if (eventType === 'tool_start') {
                        internalState.toolCallCount++;
                      }
                      if (eventType === 'tool_end') {
                        const evtData = evt?.data as Record<string, unknown> | undefined;
                        const toolName = (evtData?.name as string) || '';
                        if (toolName === 'rag_retrieve') {
                          const output = this.parseToolOutput(evtData?.output);
                          if (output?.success && output?.sources) {
                            const sourceList = output.sources as Array<{
                              chunkId: number;
                              documentId: number;
                              fileId: number | null;
                              score: number;
                            }>;
                            internalState.sources.push(...sourceList);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          continue;
        }

        // tasks 事件：子 agent 任务
        if (eventName === 'tasks') {
          const taskData = data as Record<string, unknown>;
          const taskStatus = taskData?.status as string;
          const taskName = (taskData?.name as string) || 'unnamed';

          if (taskStatus === 'started') {
            internalState.subAgentCallCount++;
          } else if (taskStatus === 'finished') {
            const success = !taskData?.error;
            internalState.subAgentSummaries.push({
              name: taskName,
              success,
              content: success ? this.extractSubAgentContent(taskData) : undefined,
            });
          }
          continue;
        }

        // errors 事件
        if (eventName === 'errors') {
          const errData = data as Record<string, unknown>;
          const errMsg = errData?.error as string;
          this.logger.error(`Deep agent error: ${errMsg}`);
          continue;
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException) || err.name !== 'AbortError') {
        this.logger.debug(
          `ProtocolEvent 迭代异常: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 消费 runStream.messages 投影中的逐 token 增量。
   *
   * runStream.messages 是 LangChain 的 ChatModelStream 投影，
   * 每条消息的 .text 属性是 TextContentStream，yield incremental text deltas。
   */
  private async *consumeMessageTokens(
    runStream: DeepAgentRunStream,
    internalState: AgentInternalState,
    signal: AbortSignal,
  ): AsyncIterable<SseEventOutput> {
    try {
      for await (const message of runStream.messages) {
        if (signal.aborted) return;
        if (internalState.isFinalAnswerEmitted) continue;

        for await (const token of (message as any).text) {
          if (signal.aborted) return;
          if (!internalState.isFinalAnswerEmitted && token) {
            internalState.answerBuilder += token;
            yield { event: 'token', data: JSON.stringify({ token }) };
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException) || err.name !== 'AbortError') {
        this.logger.debug(
          `messages 投影流异常: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** 验证会话是否存在 */

  // ── SSE token 桥接队列（async generator → async generator） ──
  // consumeMessageTokens 是 async generator，可以直接 yield，不需要队列

  /** 验证会话是否存在 */
  private async validateSession(sessionId: number): Promise<void> {
    const session = await this.chatSessionService.findOne(sessionId);
    if (!session) {
      throw new ProjectException(
        `${DEEP_AGENT_ERROR_CODE_SESSION_NOT_FOUND}: 会话 ${sessionId} 不存在`,
        404,
      );
    }
  }

  /** 生成线程 ID */
  private generateThreadId(): string {
    return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** 去重来源列表（按 chunkId 去重） */
  private deduplicateSources(
    sources: Array<{
      chunkId: number;
      documentId: number;
      fileId: number | null;
      score: number;
    }>,
  ): Array<{
    chunkId: number;
    documentId: number;
    fileId: number | null;
    score: number;
  }> {
    const seen = new Set<number>();
    const result: typeof sources = [];
    for (const s of sources) {
      if (!seen.has(s.chunkId)) {
        seen.add(s.chunkId);
        result.push(s);
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Checkpointer / Store 工厂
  // ---------------------------------------------------------------------------

  /**
   * 根据配置创建 Checkpointer 和 Store。
   * 优先使用运行时服务中已初始化的 PostgreSQL 实例，未配置时 fallback 到内存实现。
   */
  private async createCheckpointerAndStore(): Promise<{
    checkpointer: unknown;
    store: unknown;
  }> {
    const checkpointer = this.deepAgentRuntimeService.getCheckpointer();
    const store = this.deepAgentRuntimeService.getStore();

    return {
      checkpointer: checkpointer ?? (await this.createMemoryCheckpointer()),
      store: store ?? (await this.createMemoryStore()),
    };
  }

  /** 创建内存 checkpointer（fallback） */
  private async createMemoryCheckpointer(): Promise<unknown> {
    const { MemorySaver } = await import('@langchain/langgraph');
    return new MemorySaver();
  }

  /** 创建内存 store（fallback） */
  private async createMemoryStore(): Promise<unknown> {
    const { InMemoryStore } = await import('@langchain/langgraph');
    return new InMemoryStore();
  }
}
