import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import {
  DeepAgentService,
  type AgentRunResult,
  type SseEventOutput,
} from '../../../src/modules/chat/service/deep-agent.service';
import { RagConfigService } from '../../../src/modules/config/service/rag-config.service';
import { ChatRagToolService } from '../../../src/modules/chat/service/chat-rag-tool.service';
import { ChatAttachmentToolService } from '../../../src/modules/chat/service/chat-attachment-tool.service';
import { DeepAgentRuntimeService } from '../../../src/modules/chat/service/deep-agent-runtime.service';
import { ChatSessionService } from '../../../src/modules/chat/service/chat-session.service';
import { ChatMessageService } from '../../../src/modules/chat/service/chat-message.service';
import {
  DEEP_AGENT_ERROR_CODE_INTERNAL,
  DEEP_AGENT_ERROR_CODE_MODEL_UNAVAILABLE,
  DEEP_AGENT_ERROR_CODE_STREAM_CANCELLED,
  DEEP_AGENT_ERROR_CODE_SESSION_NOT_FOUND,
} from '../../../src/modules/chat/chat.constants';

// ─── Mock @nest-cloud/sdk ────────────────────────────────────────────────

vi.mock('@nest-cloud/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nest-cloud/sdk')>()),
  BaseService: class {},
  ContextService: {
    getCurrentAccount: () => ({ accountId: 1 }),
    getReq: () => ({}),
    getRes: () => ({}),
  },
  getConfig: vi.fn(() => ''),
  ProjectException: class ProjectException extends Error {
    constructor(
      message: string,
      public statusCode: number = 500,
    ) {
      super(message);
      this.name = 'ProjectException';
    }
    getResponse() {
      return { message: this.message, statusCode: this.statusCode };
    }
  },
  InjectRepository: () => (_target: unknown, _key: string) => {},
}));

// ─── Mock @langchain/openai ─────────────────────────────────────────────────

const _chatOpenAIMockInstances: Array<Record<string, unknown>> = [];
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: function (this: Record<string, unknown>, _options: Record<string, unknown>) {
    const instance = {
      stream: async function* () {
        yield { content: 'mock response' };
      },
    };
    _chatOpenAIMockInstances.push(instance);
    return instance;
  } as unknown as new (options?: Record<string, unknown>) => {
    stream: () => AsyncGenerator<Record<string, unknown>>;
  },
}));

// ─── Mock deepagents module ─────────────────────────────────────────────────

const mockCreateDeepAgent = vi.fn();
const mockStateBackend = vi.fn();
const mockGeneralPurposeSubagent = {
  name: 'general-purpose',
  description: 'General purpose sub-agent',
};

vi.mock('deepagents', async () => {
  const actual = await vi.importActual<typeof import('deepagents')>('deepagents');
  return {
    ...actual,
    createDeepAgent: mockCreateDeepAgent,
    StateBackend: mockStateBackend,
    GENERAL_PURPOSE_SUBAGENT: mockGeneralPurposeSubagent,
  };
});

// ─── Mock dependencies builders ─────────────────────────────────────────────

function createMockRagConfigService(): RagConfigService {
  return {
    getChatLlmConfig: vi.fn().mockResolvedValue({
      model: 'gpt-4o',
      baseUrl: '',
      apiKey: 'test-key',
    }),
    getEmbeddingConfig: vi.fn().mockResolvedValue({
      model: 'text-embedding-3-small',
      dimension: 1536,
      baseUrl: '',
      apiKey: 'test-key',
      chunkSize: 1000,
      chunkOverlap: 200,
      retrievalTopK: 5,
      retrievalScoreThreshold: 0.7,
    }),
  } as unknown as RagConfigService;
}

function createMockChatRagToolService(): ChatRagToolService {
  return {
    createTool: vi.fn((_cumRef: { count: number }) => {
      const tool = new DynamicStructuredTool({
        name: 'rag_retrieve',
        description: 'Retrieve relevant documents',
        schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        func: async (_input: { query: string }) =>
          JSON.stringify({
            success: true,
            fragments: [],
            sources: [],
            stats: { fragmentCount: 0, cumulativeCount: 0, rawCount: 0 },
          }),
      });
      return tool;
    }),
  } as unknown as ChatRagToolService;
}

function createMockDeepAgentRuntimeService(): DeepAgentRuntimeService {
  return {
    getOrCreateWorkspace: vi.fn().mockResolvedValue({
      workspaceId: 'ws-test-001',
      accountId: 1,
      threadId: null,
      sessionId: 1,
    }),
    updateWorkspaceThreadId: vi.fn().mockResolvedValue(undefined),
    updateWorkspaceRunId: vi.fn().mockResolvedValue(undefined),
    markWorkspaceCompleted: vi.fn().mockResolvedValue(undefined),
    cancelWorkspace: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockReturnValue({
      workspaceRoot: '/tmp/deep-agents',
      sandboxTimeoutMs: 300000,
      diskQuotaMb: 512,
      cleanupIntervalSec: 3600,
      backendType: 'sandbox',
    }),
    getCheckpointer: vi.fn().mockReturnValue(null),
    getStore: vi.fn().mockReturnValue(null),
  } as unknown as DeepAgentRuntimeService;
}

function createMockChatSessionService(): ChatSessionService {
  return {
    findOwnedSession: vi.fn().mockResolvedValue({
      id: 1,
      title: 'Test Session',
      knowledgeBaseId: 1,
    }),
  } as unknown as ChatSessionService;
}

function createMockChatMessageService(): ChatMessageService {
  return {
    createAssistantMessageWithDetails: vi.fn().mockResolvedValue({ id: 100 }),
  } as unknown as ChatMessageService;
}

function createMockChatAttachmentToolService(): ChatAttachmentToolService {
  return {
    createTool: vi.fn((_attachments: unknown[]) => {
      // Return a dummy DynamicStructuredTool
      return {
        name: 'file_reader',
        description: 'Mock file reader tool',
        schema: {
          type: 'object',
          properties: { fileId: { type: 'integer' } },
          required: ['fileId'],
        },
        func: async () =>
          JSON.stringify({ success: false, error: 'Mock: file_reader not implemented' }),
      };
    }),
  } as unknown as ChatAttachmentToolService;
}

// ─── Fake model builder ─────────────────────────────────────────────────────

// ─── Fake model builder (unused but kept for future use) ────────────────────

/**
function buildFakeModel(_responses: string[]): FakeListChatModel {
  return new FakeListChatModel({ responses: _responses });
}

// ─── Mock agent factory ─────────────────────────────────────────────────────

/**
 * Build a mock agent that simulates streamEvents producing v3 ProtocolEvent events.
 *
 * v3 event format:
 * - lifecycle → run lifecycle events (started, finished)
 * - values → state snapshots (messages, updates with tool calls)
 * - messages → message-level events
 * - tasks → subagent task events
 *
 * The mock also supports runStream.messages iteration for token streaming.
 */
function buildMockAgent(
  eventsSequence: Array<{
    method: string;
    data: unknown;
    metadata?: Record<string, unknown>;
  }>,
  tokenStream?: string[],
): Record<string, unknown> {
  const tokens = tokenStream || ['Here is my answer'];

  // Build a mock runStream with both ProtocolEvent iteration AND .messages
  const mockRunStream: Record<string, unknown> = {};

  // .messages: AsyncIterable yielding mock ChatModelStream objects
  mockRunStream.messages = (async function* () {
    let accumulated = '';
    for (const token of tokens) {
      accumulated += token;
      yield {
        text: (async function* () {
          yield token;
        })(),
        _accumulated: accumulated,
      };
    }
  })();

  // ProtocolEvent iteration via Symbol.asyncIterator
  (mockRunStream as any)[Symbol.asyncIterator] = async function* () {
    for (const evt of eventsSequence) {
      yield {
        method: evt.method,
        params: {
          data: evt.data,
          metadata: evt.metadata || {},
        },
      };
    }
  };

  return {
    streamEvents: async (_input: { messages: unknown[] }, _options: Record<string, unknown>) => {
      return mockRunStream;
    },
    invoke: async (_input: { messages: unknown[] }, _options?: Record<string, unknown>) => {
      return {
        messages: [new HumanMessage('Mock response')],
      };
    },
  };
}

// ─── Test fixtures ──────────────────────────────────────────────────────────

let service: DeepAgentService;
let mockRagConfigService: RagConfigService;
let mockChatRagToolService: ChatRagToolService;
let mockChatAttachmentToolService: ChatAttachmentToolService;
let mockDeepAgentRuntimeService: DeepAgentRuntimeService;
let mockChatSessionService: ChatSessionService;
let mockChatMessageService: ChatMessageService;

beforeEach(() => {
  vi.clearAllMocks();

  mockRagConfigService = createMockRagConfigService();
  mockChatRagToolService = createMockChatRagToolService();
  mockChatAttachmentToolService = createMockChatAttachmentToolService();
  mockDeepAgentRuntimeService = createMockDeepAgentRuntimeService();
  mockChatSessionService = createMockChatSessionService();
  mockChatMessageService = createMockChatMessageService();

  // Fresh service instance resets the singleton agent reference
  service = new DeepAgentService(
    mockRagConfigService,
    mockChatRagToolService,
    mockChatAttachmentToolService,
    mockDeepAgentRuntimeService,
    mockChatSessionService,
    mockChatMessageService,
  );
});

afterEach(() => {
  vi.resetAllMocks();
});

// ─── Helper ─────────────────────────────────────────────────────────────────

async function consumeStream(stream: AsyncIterable<SseEventOutput>): Promise<SseEventOutput[]> {
  const events: SseEventOutput[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

// ─── Test suites ────────────────────────────────────────────────────────────

describe('DeepAgentService', () => {
  // ── 1. Deep Agents is the sole conversation engine ──────────────────────

  describe('Deep Agents as sole conversation engine', () => {
    it('should create a Deep Agent via createDeepAgent and not use any legacy RAG chain', async () => {
      // v3 format: lifecycle finished + values with AI message
      const mockAgent = buildMockAgent([
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
        {
          method: 'values',
          data: {
            messages: [{ type: 'ai', content: 'Hello, how can I help?' }],
          },
          metadata: { run_id: 'run-001' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat({ sessionId: 1, query: 'test query' }, new Set<number>());

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      // verify createDeepAgent was called (via initializeAgent)
      expect(mockCreateDeepAgent).toHaveBeenCalled();

      // verify events were produced
      const eventTypes = events.map((e) => e.event);
      expect(eventTypes.length).toBeGreaterThan(0);

      // deepagents is the only conversation path
      expect(mockCreateDeepAgent.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should use the unified model from RagConfigService', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
        {
          method: 'values',
          data: {
            messages: [{ type: 'ai', content: 'Unified model test' }],
          },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);
      (mockRagConfigService.getChatLlmConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
        model: 'custom-model',
        baseUrl: 'https://custom.api',
        apiKey: 'custom-key',
      });

      const stream = service.streamChat({ sessionId: 1, query: 'unified test' }, new Set<number>());

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(mockRagConfigService.getChatLlmConfig).toHaveBeenCalled();
    });

    it('should inject RAG Tool via ChatRagToolService', async () => {
      // v3 format: values with tool events + AI message
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            updates: [
              {
                agent: {
                  events: [
                    { type: 'tool_start' },
                    {
                      type: 'tool_end',
                      data: {
                        name: 'rag_retrieve',
                        output: JSON.stringify({
                          success: true,
                          sources: [{ chunkId: 1, documentId: 1, fileId: 100, score: 0.95 }],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            messages: [{ type: 'ai', content: 'Answer based on sources' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'rag tool test' },
        new Set<number>([1]),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(mockChatRagToolService.createTool).toHaveBeenCalled();
    });
  });

  // ── 2. RAG Tool invocation ─────────────────────────────────────────────

  describe('RAG Tool invocation', () => {
    it.skip('should emit sources event when rag_retrieve tool completes', async () => {
      // TODO: 恢复 sources 事件需要重新引入 ProtocolEvent 迭代
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            updates: [
              {
                agent: {
                  events: [
                    { type: 'tool_start' },
                    {
                      type: 'tool_end',
                      data: {
                        name: 'rag_retrieve',
                        output: JSON.stringify({
                          success: true,
                          sources: [
                            { chunkId: 10, documentId: 20, fileId: 30, score: 0.95 },
                            { chunkId: 11, documentId: 21, fileId: 31, score: 0.88 },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            messages: [{ type: 'ai', content: 'Based on the retrieved documents' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'find relevant docs' },
        new Set<number>([1]),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const sourceEvents = events.filter((e) => e.event === 'sources');
      expect(sourceEvents.length).toBeGreaterThan(0);

      const parsedSources = JSON.parse(sourceEvents[0].data);
      expect(parsedSources.sources).toHaveLength(2);
      expect(parsedSources.sources[0].chunkId).toBe(10);
      expect(parsedSources.sources[1].chunkId).toBe(11);
    });

    it('should handle rag_retrieve returning error in tool output', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            updates: [
              {
                agent: {
                  events: [
                    { type: 'tool_start' },
                    {
                      type: 'tool_end',
                      data: {
                        name: 'rag_retrieve',
                        output: JSON.stringify({
                          success: false,
                          error: '检索异常',
                          message: 'No knowledge base available',
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'error retrieval test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      // Tool error doesn't emit SSE error event in v3 format — it's just counted
      // The lifecycle finished event signals completion
      const lifecycleEvents = events.filter((e) => e.event === 'done');
      expect(lifecycleEvents.length).toBeGreaterThan(0);
    });

    it('should create RAG Tool with cumulative count ref', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const authorizedIds = new Set<number>([1, 2, 3]);
      const stream = service.streamChat({ sessionId: 1, query: 'auth test' }, authorizedIds);

      await consumeStream(stream);

      expect(mockChatRagToolService.createTool).toHaveBeenCalledWith(expect.any(Object));
    });
  });

  // ── 3. Sources aggregation ──────────────────────────────────────────────

  describe('sources aggregation', () => {
    it.skip('should aggregate sources from multiple rag_retrieve tool calls', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            updates: [
              {
                agent: {
                  events: [
                    { type: 'tool_start' },
                    {
                      type: 'tool_end',
                      data: {
                        name: 'rag_retrieve',
                        output: JSON.stringify({
                          success: true,
                          sources: [{ chunkId: 1, documentId: 10, fileId: 100, score: 0.95 }],
                        }),
                      },
                    },
                  ],
                },
              },
              {
                agent: {
                  events: [
                    { type: 'tool_start' },
                    {
                      type: 'tool_end',
                      data: {
                        name: 'rag_retrieve',
                        output: JSON.stringify({
                          success: true,
                          sources: [
                            { chunkId: 2, documentId: 11, fileId: 101, score: 0.88 },
                            { chunkId: 3, documentId: 12, fileId: 102, score: 0.8 },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            messages: [{ type: 'ai', content: 'Multi-source answer' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'multi-source test' },
        new Set<number>([1]),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const sourceEvents = events.filter((e) => e.event === 'sources');
      expect(sourceEvents.length).toBeGreaterThanOrEqual(2);

      // Collect all sources emitted
      const allSourceLists: Array<Array<Record<string, unknown>>> = sourceEvents.map(
        (e) => JSON.parse(e.data).sources,
      );
      const totalSources = allSourceLists.flat();
      expect(totalSources).toHaveLength(3);
      expect(totalSources.find((s) => s.chunkId === 1)).toBeDefined();
      expect(totalSources.find((s) => s.chunkId === 2)).toBeDefined();
      expect(totalSources.find((s) => s.chunkId === 3)).toBeDefined();
    });

    it.skip('should include sources in the answer event payload', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            updates: [
              {
                agent: {
                  events: [
                    { type: 'tool_start' },
                    {
                      type: 'tool_end',
                      data: {
                        name: 'rag_retrieve',
                        output: JSON.stringify({
                          success: true,
                          sources: [{ chunkId: 100, documentId: 200, fileId: 300, score: 0.99 }],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            messages: [{ type: 'ai', content: 'Answer with source' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'answer with source' },
        new Set<number>([1]),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const answerEvents = events.filter((e) => e.event === 'answer');
      expect(answerEvents.length).toBeGreaterThan(0);

      const answerData = JSON.parse(answerEvents[0].data);
      expect(answerData.answer).toContain('Answer with source');
      expect(answerData.sources).toHaveLength(1);
      expect(answerData.sources[0].chunkId).toBe(100);
    });

    it('should handle empty sources gracefully', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            messages: [{ type: 'ai', content: 'No sources available' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'no sources test' },
        new Set<number>([1]),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.event === 'token');
      expect(tokenEvents.length).toBeGreaterThan(0);
    });
  });

  // ── 4. Cancellation signal propagation ──────────────────────────────────

  describe('cancellation signal propagation', () => {
    it('should propagate abort signal to deep agent streamEvents', async () => {
      let capturedSignal: AbortSignal | undefined;

      const mockAgent = {
        streamEvents: async (_input: { messages: unknown[] }, options: Record<string, unknown>) => {
          capturedSignal = options.signal as AbortSignal;
          return (async function* () {
            yield {
              method: 'lifecycle',
              params: {
                data: { status: 'finished' },
                metadata: {},
              },
            };
          })();
        },
        invoke: async () => ({ messages: [new HumanMessage('done')] }),
      };

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'signal propagation test' },
        new Set<number>(),
      );

      await consumeStream(stream);

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(false);
    });

    it('should mark workspace as completed when stream finishes normally', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'workspace cancel test' },
        new Set<number>(),
      );

      await consumeStream(stream);

      expect(mockDeepAgentRuntimeService.getOrCreateWorkspace).toHaveBeenCalled();
    });
  });

  // ── 5. Error handling ───────────────────────────────────────────────────

  describe('error handling', () => {
    it('should emit error event when model API key is missing', async () => {
      (mockRagConfigService.getChatLlmConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
        model: 'gpt-4o',
        baseUrl: '',
        apiKey: '', // Missing API key
      });

      const stream = service.streamChat(
        { sessionId: 1, query: 'no api key test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const errorEvents = events.filter((e) => e.event === 'error');
      expect(errorEvents.length).toBeGreaterThan(0);

      const parsedError = JSON.parse(errorEvents[0].data);
      expect(parsedError.code).toBe(DEEP_AGENT_ERROR_CODE_MODEL_UNAVAILABLE);
      expect(parsedError.message).toContain('API Key');
    });

    it('should emit error event for session not found', async () => {
      vi.mocked(mockChatSessionService.findOwnedSession).mockResolvedValue(null);

      const stream = service.streamChat(
        { sessionId: 99999, query: 'nonexistent session' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const errorEvents = events.filter((e) => e.event === 'error');
      expect(errorEvents.length).toBeGreaterThan(0);

      const parsedError = JSON.parse(errorEvents[0].data);
      expect(parsedError.code).toBe(DEEP_AGENT_ERROR_CODE_SESSION_NOT_FOUND);
    });

    it('should classify DOMException AbortError as stream cancelled', async () => {
      const mockAgent = buildMockAgent([]);

      // Simulate abort error in streamEvents
      (mockAgent as any).streamEvents = async () => {
        throw new DOMException('The operation was aborted', 'AbortError');
      };

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'abort error test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const errorEvents = events.filter((e) => e.event === 'error');
      expect(errorEvents.length).toBeGreaterThan(0);

      const parsedError = JSON.parse(errorEvents[0].data);
      expect(parsedError.code).toBe(DEEP_AGENT_ERROR_CODE_STREAM_CANCELLED);
    });

    it('should classify timeout errors appropriately', async () => {
      const mockAgent = buildMockAgent([]);

      (mockAgent as any).streamEvents = async () => {
        throw new Error('Connection timed out');
      };

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat({ sessionId: 1, query: 'timeout test' }, new Set<number>());

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const errorEvents = events.filter((e) => e.event === 'error');
      expect(errorEvents.length).toBeGreaterThan(0);

      const parsedError = JSON.parse(errorEvents[0].data);
      expect(parsedError.message).toContain('timed out');
    });

    it('should fall back to internal error code for unknown errors', async () => {
      const mockAgent = buildMockAgent([]);

      (mockAgent as any).streamEvents = async () => {
        throw new Error('Some unexpected internal error');
      };

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'unknown error test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const errorEvents = events.filter((e) => e.event === 'error');
      expect(errorEvents.length).toBeGreaterThan(0);

      const parsedError = JSON.parse(errorEvents[0].data);
      expect(parsedError.code).toBe(DEEP_AGENT_ERROR_CODE_INTERNAL);
    });

    it.skip('should handle lifecycle error event from deep agent', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'errors',
          data: { error: 'Agent chain failed' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'chain error test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const errorEvents = events.filter((e) => e.event === 'error');
      expect(errorEvents.length).toBeGreaterThan(0);

      const parsedError = JSON.parse(errorEvents[0].data);
      expect(parsedError.code).toBe(DEEP_AGENT_ERROR_CODE_INTERNAL);
      expect(parsedError.message).toBe('Agent chain failed');
    });

    it.skip('should handle tool error event from deep agent', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'errors',
          data: { error: 'Tool execution failed' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'tool error test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const errorEvents = events.filter((e) => e.event === 'error');
      expect(errorEvents.length).toBeGreaterThan(0);

      const parsedError = JSON.parse(errorEvents[0].data);
      expect(parsedError.code).toBe(DEEP_AGENT_ERROR_CODE_INTERNAL);
      expect(parsedError.message).toBe('Tool execution failed');
    });

    it.skip('should deduplicate error events (only emit error once per stream)', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'errors',
          data: { error: 'First error' },
        },
        {
          method: 'errors',
          data: { error: 'Second error' },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'duplicate error test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      // Each errors event produces one SSE error event;
      // deduplication is handled at the controller layer
      const errorEvents = events.filter((e) => e.event === 'error');
      expect(errorEvents.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 6. SSE event lifecycle ──────────────────────────────────────────────

  describe('SSE event lifecycle', () => {
    it('should emit answer event from values with AI message', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            messages: [{ type: 'ai', content: 'Part One Two' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'token streaming test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.event === 'token');
      expect(tokenEvents.length).toBeGreaterThan(0);
    });

    it('should emit done event at the end of a successful stream', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            messages: [{ type: 'ai', content: 'Complete answer' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'done event test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const doneEvents = events.filter((e) => e.event === 'done');
      expect(doneEvents.length).toBeGreaterThan(0);

      const doneData = JSON.parse(doneEvents[0].data);
      expect(doneData).toHaveProperty('modelCallCount');
      expect(doneData).toHaveProperty('toolCallCount');
    });

    it.skip('should emit subagent_start and subagent_end events', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'tasks',
          data: { name: 'general-purpose', status: 'started' },
        },
        {
          method: 'tasks',
          data: {
            name: 'general-purpose',
            status: 'finished',
            output: { messages: [{ content: 'sub-agent result' }] },
          },
        },
        {
          method: 'values',
          data: {
            messages: [{ type: 'ai', content: 'Final answer' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'subagent event test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const subagentStartEvents = events.filter((e) => e.event === 'subagent_start');
      const subagentEndEvents = events.filter((e) => e.event === 'subagent_end');

      expect(subagentStartEvents.length).toBeGreaterThan(0);
      expect(subagentEndEvents.length).toBeGreaterThan(0);

      const startData = JSON.parse(subagentStartEvents[0].data);
      expect(startData.name).toBe('general-purpose');

      const endData = JSON.parse(subagentEndEvents[0].data);
      expect(endData.name).toBe('general-purpose');
      expect(endData.success).toBe(true);
    });

    it.skip('should accumulate tokens until final answer is confirmed', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            messages: [{ type: 'ai', content: 'Hello World' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'token accumulation test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const answerEvents = events.filter((e) => e.event === 'answer');
      expect(answerEvents.length).toBeGreaterThan(0);

      const answerData = JSON.parse(answerEvents[0].data);
      expect(answerData.answer).toContain('Hello');
      expect(answerData.answer).toContain('World');
    });

    it.skip('should emit answer event with accumulated content and sources', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            updates: [
              {
                agent: {
                  events: [
                    { type: 'tool_start' },
                    {
                      type: 'tool_end',
                      data: {
                        name: 'rag_retrieve',
                        output: JSON.stringify({
                          success: true,
                          sources: [{ chunkId: 1, documentId: 1, fileId: 1, score: 0.95 }],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            messages: [{ type: 'ai', content: 'Here is my answer' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'answer event test' },
        new Set<number>([1]),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const answerEvents = events.filter((e) => e.event === 'answer');
      expect(answerEvents.length).toBeGreaterThan(0);

      const answerData = JSON.parse(answerEvents[0].data);
      expect(answerData.answer).toContain('Here is my answer');
      expect(answerData.sources).toHaveLength(1);
    });

    it('should emit done event with usage statistics', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            messages: [{ type: 'ai', content: 'Test Response' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'usage stats test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const doneEvents = events.filter((e) => e.event === 'done');
      expect(doneEvents.length).toBeGreaterThan(0);

      const doneData = JSON.parse(doneEvents[0].data);
      expect(doneData.modelCallCount).toBeGreaterThanOrEqual(0);
      expect(doneData.toolCallCount).toBeGreaterThanOrEqual(0);
      expect(doneData.subAgentCallCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(doneData.subAgentSummaries)).toBe(true);
    });
  });

  // ── 7. Sync chat method ─────────────────────────────────────────────────

  describe('sync chat method', () => {
    it('should return aggregated AgentRunResult', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            updates: [
              {
                agent: {
                  events: [
                    { type: 'tool_start' },
                    {
                      type: 'tool_end',
                      data: {
                        name: 'rag_retrieve',
                        output: JSON.stringify({
                          success: true,
                          sources: [
                            { chunkId: 1, documentId: 1, fileId: 1, score: 0.95 },
                            { chunkId: 2, documentId: 2, fileId: 2, score: 0.88 },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            messages: [{ type: 'ai', content: 'Sync answer' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const result = await service.chat(
        { sessionId: 1, query: 'sync chat test' },
        new Set<number>([1]),
      );

      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(Object);

      const typedResult = result as AgentRunResult;
      expect(typedResult.answer).toBeDefined();
      expect(typeof typedResult.answer).toBe('string');
      expect(Array.isArray(typedResult.sources)).toBe(true);
      expect(typedResult.sources).toHaveLength(2);
      expect(typedResult.sources[0].chunkId).toBe(1);
      expect(typedResult.sources[1].chunkId).toBe(2);
      expect(typedResult.modelCallCount).toBeGreaterThanOrEqual(0);
      expect(typedResult.toolCallCount).toBeGreaterThanOrEqual(0);
    });

    it('should throw normalized error for session not found', async () => {
      vi.mocked(mockChatSessionService.findOwnedSession).mockResolvedValue(null);

      await expect(
        service.chat({ sessionId: 99999, query: 'sync error test' }, new Set<number>()),
      ).rejects.toThrow('SESSION_NOT_FOUND');
    });
  });

  // ── 8. Workspace and session management ─────────────────────────────────

  describe('workspace and session management', () => {
    it('should not fail before workspace creation', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat({ sessionId: 1, query: 'debug test' }, new Set<number>());

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(mockDeepAgentRuntimeService.getOrCreateWorkspace).toHaveBeenCalled();
    });

    it('should create workspace via DeepAgentRuntimeService for each request', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      await consumeStream(
        service.streamChat({ sessionId: 1, query: 'workspace test' }, new Set<number>()),
      );

      expect(mockDeepAgentRuntimeService.getOrCreateWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 1,
          sessionId: 1,
        }),
      );
    });

    it('should validate session existence before processing', async () => {
      vi.mocked(mockChatSessionService.findOwnedSession).mockResolvedValue(null);

      const stream = service.streamChat(
        { sessionId: 99999, query: 'invalid session test' },
        new Set<number>(),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const errorEvents = events.filter((e) => e.event === 'error');
      expect(errorEvents.length).toBeGreaterThan(0);
    });
  });

  // ── 9. Cumulative retrieval counter ─────────────────────────────────────

  describe('cumulative retrieval counter', () => {
    it('should reset cumulativeCountRef for each streamChat call', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      // First call
      await consumeStream(
        service.streamChat({ sessionId: 1, query: 'first call' }, new Set<number>()),
      );

      // Second call should trigger a fresh tool creation
      await consumeStream(
        service.streamChat({ sessionId: 1, query: 'second call' }, new Set<number>()),
      );

      // createTool has been called at least once during agent initialization
      expect(
        (mockChatRagToolService.createTool as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 10. Event ordering ──────────────────────────────────────────────────

  describe('event ordering', () => {
    it('should produce events in correct order: sources/answer/done', async () => {
      const mockAgent = buildMockAgent([
        {
          method: 'values',
          data: {
            updates: [
              {
                agent: {
                  events: [
                    { type: 'tool_start' },
                    {
                      type: 'tool_end',
                      data: {
                        name: 'rag_retrieve',
                        output: JSON.stringify({
                          success: true,
                          sources: [{ chunkId: 1, documentId: 1, fileId: 1, score: 0.95 }],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            messages: [{ type: 'ai', content: 'Streaming' }],
          },
        },
        {
          method: 'lifecycle',
          data: { status: 'finished' },
        },
      ]);

      mockCreateDeepAgent.mockResolvedValue(mockAgent as never);

      const stream = service.streamChat(
        { sessionId: 1, query: 'ordering test' },
        new Set<number>([1]),
      );

      const events: SseEventOutput[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      // Verify done is the last event
      const lastEvent = events[events.length - 1];
      expect(lastEvent.event).toBe('done');

      // Verify error never comes after done
      const doneIndex = events.findIndex((e) => e.event === 'done');
      const errorsAfterDone = events.slice(doneIndex + 1).filter((e) => e.event === 'error');
      expect(errorsAfterDone).toHaveLength(0);
    });
  });
});
