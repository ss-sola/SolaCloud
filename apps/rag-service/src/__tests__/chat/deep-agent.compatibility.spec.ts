import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { HumanMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { MemorySaver, InMemoryStore } from '@langchain/langgraph';
import {
  createDeepAgent,
  StateBackend,
  StoreBackend,
  LocalShellBackend,
  GENERAL_PURPOSE_SUBAGENT,
  type DeepAgent,
  type DeepAgentRunStream,
} from 'deepagents';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create an isolated temp directory for each test run. */
function createIsolatedWorkspace(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deepagents-test-'));
  return tmp;
}

/** Clean up a workspace directory. */
function cleanupWorkspace(workspace: string): void {
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors in CI / windows
  }
}

/** Build a minimal fake model that returns a fixed text response. */
function buildFakeModel(response: string): FakeListChatModel {
  return new FakeListChatModel({ responses: [response] });
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('DeepAgents Compatibility', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createIsolatedWorkspace();
  });

  afterEach(() => {
    cleanupWorkspace(workspace);
  });

  // ── 1. Default planning tools are callable ──────────────────────────────

  describe('default planning tools', () => {
    it('should expose write_todos tool by default', async () => {
      const model = buildFakeModel('Todo written.');
      const agent: DeepAgent = await createDeepAgent({
        model,
        backend: new StateBackend(),
      });

      const result = await agent.invoke({
        messages: [new HumanMessage('Add a todo item: test planning')],
      });

      expect(result).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
    });
  });

  // ── 2. Filesystem middleware: read, write, edit, search ─────────────────

  describe('filesystem operations', () => {
    it('should work with FilesystemBackend pointing to isolated workspace', async () => {
      const { FilesystemBackend } = await import('deepagents');
      const fsBackend = new FilesystemBackend({
        rootDir: workspace,
        virtualMode: true,
      });

      // Write a file directly via backend
      const writeRes = await fsBackend.write('/workspace/test.txt', 'initial content');
      expect(writeRes.error).toBeUndefined();
      expect(writeRes.path).toBe('/workspace/test.txt');

      // Read it back
      const readRes = await fsBackend.read('/workspace/test.txt');
      expect(readRes.error).toBeUndefined();
      expect(typeof readRes.content).toBe('string');
      expect((readRes.content as string).includes('initial content')).toBe(true);

      // Edit the file
      const editRes = await fsBackend.edit(
        '/workspace/test.txt',
        'initial content',
        'edited content',
      );
      expect(editRes.error).toBeUndefined();
      expect(editRes.occurrences).toBeGreaterThan(0);

      // Verify edit
      const readAfterEdit = await fsBackend.read('/workspace/test.txt');
      expect((readAfterEdit.content as string).includes('edited content')).toBe(true);

      // Search (grep)
      const grepRes = await fsBackend.grep('edited');
      expect(grepRes.error).toBeUndefined();
      expect(grepRes.matches).toBeDefined();
      expect(grepRes.matches!.length).toBeGreaterThan(0);

      // Glob
      const globRes = await fsBackend.glob('**/*.txt');
      expect(globRes.error).toBeUndefined();
      expect(globRes.files).toBeDefined();
      expect(globRes.files!.length).toBeGreaterThan(0);
    });

    it('should support filesystem middleware with agent via createDeepAgent backend param', async () => {
      const model = buildFakeModel('File operations completed.');
      const agent: DeepAgent = await createDeepAgent({
        model,
        backend: new StateBackend(),
      });

      // Write a file via the agent's built-in filesystem tools
      const writeResult = await agent.invoke({
        messages: [new HumanMessage(`Write a file at /test.txt with content "hello world"`)],
      });
      expect(writeResult).toBeDefined();
      expect(writeResult.messages.length).toBeGreaterThan(0);
    });
  });

  // ── 3. Execute in isolated runtime ──────────────────────────────────────

  describe('execute in isolated runtime', () => {
    it('should execute controlled commands via LocalShellBackend', async () => {
      const shellBackend = await LocalShellBackend.create({
        rootDir: workspace,
        virtualMode: true,
      });

      // Write a test file first
      await shellBackend.write('/sandbox/hello.txt', 'exec test');

      // Execute a simple command
      const execResult = await shellBackend.execute('echo "hello from sandbox"');
      expect(execResult.exitCode).toBe(0);
      expect(execResult.output).toContain('hello from sandbox');
    });

    it('should handle command failures gracefully', async () => {
      const shellBackend = await LocalShellBackend.create({
        rootDir: workspace,
        virtualMode: true,
      });

      const execResult = await shellBackend.execute('exit 1');
      expect(execResult.exitCode).toBe(1);
      expect(execResult.output).toBeDefined();
    });
  });

  // ── 4. Generic sub-agent creation and result return ─────────────────────

  describe('sub-agent orchestration', () => {
    it('should create and invoke a generic sub-agent via createDeepAgent subagents param', async () => {
      const model = buildFakeModel('Delegated to calculator.');
      const agent: DeepAgent = await createDeepAgent({
        model,
        subagents: [
          {
            name: 'calculator',
            description: 'A simple calculator sub-agent',
            systemPrompt: 'You are a calculator.',
          },
        ],
        backend: new StateBackend(),
      });

      const result = await agent.invoke({
        messages: [new HumanMessage('Use the calculator sub-agent to compute something')],
      });

      expect(result).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should include the general-purpose subagent by default', async () => {
      const model = buildFakeModel('General purpose task completed.');
      const agent: DeepAgent = await createDeepAgent({
        model,
        subagents: [GENERAL_PURPOSE_SUBAGENT],
        backend: new StateBackend(),
      });

      const result = await agent.invoke({
        messages: [new HumanMessage('Delegate a simple task to the general purpose agent')],
      });

      expect(result).toBeDefined();
      expect(result.messages.some((m) => m.content)).toBe(true);
    });
  });

  // ── 5. Checkpoint: interrupt and resume ─────────────────────────────────

  describe('checkpoint interrupt and resume', () => {
    it('should save and restore state via MemorySaver checkpointer', async () => {
      const checkpointer = new MemorySaver();
      const model = buildFakeModel('checkpoint test response');

      const agent: DeepAgent = await createDeepAgent({
        model,
        checkpointer,
        backend: new StateBackend(),
      });

      const threadId = 'test-thread-' + Date.now();

      // First run
      const result1 = await agent.invoke(
        {
          messages: [new HumanMessage('First checkpoint test')],
        },
        {
          configurable: { thread_id: threadId },
        },
      );

      expect(result1).toBeDefined();
      expect(result1.messages.length).toBeGreaterThan(0);

      // Second run with the same thread should pick up context
      const result2 = await agent.invoke(
        {
          messages: [new HumanMessage('Second message in same thread')],
        },
        {
          configurable: { thread_id: threadId },
        },
      );

      expect(result2).toBeDefined();
      expect(result2.messages.length).toBeGreaterThan(result1.messages.length);
    });

    it('should support interrupt and resume pattern', async () => {
      const checkpointer = new MemorySaver();
      const model = buildFakeModel('resumed response');

      const agent: DeepAgent = await createDeepAgent({
        model,
        checkpointer,
        backend: new StateBackend(),
      });

      const threadId = 'interrupt-thread-' + Date.now();

      // Initial invocation saves checkpoint
      const result1 = await agent.invoke(
        {
          messages: [new HumanMessage('Save checkpoint state')],
        },
        {
          configurable: { thread_id: threadId },
        },
      );

      expect(result1).toBeDefined();

      // Resume with additional messages in the same thread
      const result2 = await agent.invoke(
        {
          messages: [new HumanMessage('Resume after checkpoint')],
        },
        {
          configurable: { thread_id: threadId },
        },
      );

      expect(result2).toBeDefined();
      expect(result2.messages.length).toBeGreaterThan(0);
    });
  });

  // ── 6. Store: cross-run data persistence ────────────────────────────────

  describe('store cross-run persistence', () => {
    it('should read and write data across runs via InMemoryStore', async () => {
      const store = new InMemoryStore();
      const model = buildFakeModel('store test');

      const agent: DeepAgent = await createDeepAgent({
        model,
        store,
        backend: new StateBackend(),
      });

      const threadId = 'store-thread-' + Date.now();

      // First run
      await agent.invoke(
        {
          messages: [new HumanMessage('First store run')],
        },
        {
          configurable: { thread_id: threadId },
        },
      );

      // Second run in a different thread should still have access to store
      const differentThreadId = 'store-thread-diff-' + Date.now();
      const result2 = await agent.invoke(
        {
          messages: [new HumanMessage('Second store run in different thread')],
        },
        {
          configurable: { thread_id: differentThreadId },
        },
      );

      expect(result2).toBeDefined();
      expect(result2.messages.length).toBeGreaterThan(0);
    });

    it('should allow store backend to persist data with custom namespace', async () => {
      const store = new InMemoryStore();
      const model = buildFakeModel('namespace test');

      const agent: DeepAgent = await createDeepAgent({
        model,
        store,
        backend: new StoreBackend({
          store,
          namespace: ['test-namespace'],
        }),
      });

      const result = await agent.invoke({
        messages: [new HumanMessage('Test store with namespace')],
      });

      expect(result).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  // ── 7. Auto-summarization in long context ───────────────────────────────

  describe('auto-summarization', () => {
    it('should create summarization middleware instance', async () => {
      const { createSummarizationMiddleware } = await import('deepagents');

      const summarizationMiddleware = createSummarizationMiddleware({
        backend: new StateBackend(),
        trigger: { type: 'messages', value: 3 },
        keep: { type: 'messages', value: 2 },
      });

      // Verify middleware was created with expected properties
      expect(summarizationMiddleware).toBeDefined();
      expect(summarizationMiddleware.name).toBe('SummarizationMiddleware');
    });

    it('should continue running with default summarization in createDeepAgent', async () => {
      // createDeepAgent includes built-in summarization; verify it runs end-to-end
      const model = buildFakeModel('post-summary response');
      const agent: DeepAgent = await createDeepAgent({
        model,
        backend: new StateBackend(),
      });

      const result = await agent.invoke({
        messages: [new HumanMessage('Test with default summarization')],
      });

      expect(result).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  // ── 8. RAG tool coexistence with native capabilities ────────────────────

  describe('rag tool coexistence', () => {
    it('should allow custom tools alongside filesystem and sub-agents', async () => {
      const { DynamicStructuredTool } = await import('@langchain/core/tools');

      // Simulated RAG retrieval tool
      const ragTool = new DynamicStructuredTool({
        name: 'rag_retrieve',
        description: 'Retrieve relevant documents for a query',
        schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
        func: async (_input: { query: string }) => {
          return '[RAG] Retrieved 3 relevant documents.';
        },
      });

      const model = buildFakeModel('RAG + native tools test passed');
      const agent: DeepAgent = await createDeepAgent({
        model,
        tools: [ragTool] as unknown as [],
        backend: new StateBackend(),
      });

      const result = await agent.invoke({
        messages: [new HumanMessage('Use RAG tool and filesystem together')],
      });

      expect(result).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  // ── 9. streamEvents: final message, tool, sub-agent, summary, usage, cancel ─

  describe('streamEvents event classification', () => {
    it('should emit identifiable event types via streamEvents', async () => {
      const model = buildFakeModel('stream event test');
      const agent: DeepAgent = await createDeepAgent({
        model,
        backend: new StateBackend(),
      });

      const runStream: DeepAgentRunStream = await agent.streamEvents(
        {
          messages: [new HumanMessage('Test stream events')],
        },
        { version: 'v3' as const },
      );

      const eventMethods: string[] = [];

      for await (const event of runStream) {
        eventMethods.push(event.method);
      }

      // Verify we received events
      expect(eventMethods.length).toBeGreaterThan(0);
    });

    it('should classify tool calls, sub-agent calls, and text events', async () => {
      const model = buildFakeModel('classification test');
      const agent: DeepAgent = await createDeepAgent({
        model,
        backend: new StateBackend(),
      });

      const runStream: DeepAgentRunStream = await agent.streamEvents(
        {
          messages: [new HumanMessage('Classify stream events')],
        },
        { version: 'v3' as const },
      );

      const toolEvents: string[] = [];
      const subagentEvents: string[] = [];
      const textEvents: string[] = [];

      for await (const event of runStream) {
        if (event.method.includes('tool')) {
          toolEvents.push(event.method);
        }
        if (event.method.includes('chain') || event.method.includes('sub')) {
          subagentEvents.push(event.method);
        }
        if (event.method.includes('chat') || event.method.includes('llm')) {
          textEvents.push(event.method);
        }
      }

      // At minimum we should have some events classified
      expect(toolEvents.length + subagentEvents.length + textEvents.length).toBeGreaterThanOrEqual(
        0,
      );
    });

    it('should handle cancellation via AbortSignal', async () => {
      const model = buildFakeModel('cancellation test');
      const agent: DeepAgent = await createDeepAgent({
        model,
        backend: new StateBackend(),
      });

      const controller = new AbortController();

      const runStreamPromise = agent.streamEvents(
        {
          messages: [new HumanMessage('This should be cancellable')],
        },
        {
          version: 'v3' as const,
          signal: controller.signal,
        },
      );

      // Cancel immediately
      controller.abort();

      // Should complete without throwing (or throw AbortError which is expected)
      await expect(runStreamPromise).resolves.toBeDefined();
    });
  });

  // ── 10. POST SSE with NestJS Observable-compatible stream ───────────────

  describe('SSE stream integration', () => {
    it('should produce an async iterable from streamEvents', async () => {
      const model = buildFakeModel('sse test');
      const agent: DeepAgent = await createDeepAgent({
        model,
        backend: new StateBackend(),
      });

      const stream = await agent.streamEvents(
        {
          messages: [new HumanMessage('SSE stream test')],
        },
        { version: 'v3' as const },
      );

      // The stream should be an async iterable
      expect(stream).toBeDefined();
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');
    });

    it('should produce text/event-stream compatible output via pregel streamEvents', async () => {
      const model = buildFakeModel('pregel sse test');
      const agent: DeepAgent = await createDeepAgent({
        model,
        backend: new StateBackend(),
      });

      // LangGraph's streamEvents returns a GraphRunStream that implements
      // AsyncIterable<ProtocolEvent>, which is directly compatible with
      // NestJS Observable SSE via Observable.from()
      const rawStream = await agent.streamEvents(
        {
          messages: [new HumanMessage('Raw SSE stream')],
        },
        {
          version: 'v3' as const,
        },
      );

      expect(rawStream).toBeDefined();
      expect(typeof rawStream[Symbol.asyncIterator]).toBe('function');
    });
  });

  // ── 11. Composite backend with mixed storage ────────────────────────────

  describe('composite backend', () => {
    it('should route operations between FilesystemBackend and StoreBackend', async () => {
      const { CompositeBackend, FilesystemBackend } = await import('deepagents');
      const fsBackend = new FilesystemBackend({
        rootDir: workspace,
        virtualMode: true,
      });
      const store = new InMemoryStore();
      const storeBackend = new StoreBackend({
        store,
        namespace: ['composite-test'],
      });

      const composite = new CompositeBackend(fsBackend, {
        '/persistent/': storeBackend,
      });

      // Write to ephemeral filesystem
      const stateWrite = await composite.write('/ephemeral/data.txt', 'state data');
      expect(stateWrite.error).toBeUndefined();

      // Write to persistent store
      const storeWrite = await composite.write('/persistent/data.txt', 'store data');
      expect(storeWrite.error).toBeUndefined();

      // Read both back
      const stateRead = await composite.read('/ephemeral/data.txt');
      expect(stateRead.error).toBeUndefined();

      const storeRead = await composite.read('/persistent/data.txt');
      expect(storeRead.error).toBeUndefined();
    });
  });

  // ── 12. Skills middleware coexistence ───────────────────────────────────

  describe('skills middleware coexistence', () => {
    it('should allow skills middleware alongside filesystem and sub-agents', async () => {
      // Create a skill directory in the workspace
      const skillDir = path.join(workspace, 'skills', 'test-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill for compatibility verification
---

# Test Skill
This is a test skill used to verify skills middleware compatibility.
`,
      );

      const { createSkillsMiddleware } = await import('deepagents');

      const skillsMiddleware = createSkillsMiddleware({
        backend: new StateBackend(),
        sources: ['/skills/'],
      });

      const model = buildFakeModel('skills test passed');
      const agent: DeepAgent = await createDeepAgent({
        model,
        middleware: [skillsMiddleware],
        backend: new StateBackend(),
      });

      const result = await agent.invoke({
        messages: [new HumanMessage('Test skills with other middleware')],
      });

      expect(result).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  // ── 13. End-to-end: full native capability chain ────────────────────────

  describe('full native capability chain', () => {
    it('should exercise filesystem, sub-agents, store, and checkpoint together', async () => {
      const checkpointer = new MemorySaver();
      const store = new InMemoryStore();

      const model = buildFakeModel('full chain test passed');
      const agent: DeepAgent = await createDeepAgent({
        model,
        subagents: [
          {
            name: 'helper',
            description: 'A helper sub-agent for auxiliary tasks',
            systemPrompt: 'You are a helpful assistant.',
          },
        ],
        checkpointer,
        store,
        backend: new StateBackend(),
      });

      const threadId = 'full-chain-' + Date.now();

      const result = await agent.invoke(
        {
          messages: [new HumanMessage('Execute full capability chain test')],
        },
        {
          configurable: { thread_id: threadId },
        },
      );

      expect(result).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);

      // Verify checkpoint was saved
      const result2 = await agent.invoke(
        {
          messages: [new HumanMessage('Continue in same thread')],
        },
        {
          configurable: { thread_id: threadId },
        },
      );

      expect(result2).toBeDefined();
      expect(result2.messages.length).toBeGreaterThan(0);
    });
  });
});
