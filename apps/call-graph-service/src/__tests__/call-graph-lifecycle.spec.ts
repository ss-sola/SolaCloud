import type { Response } from 'express';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextService, ResponseUtil } from '@nest-cloud/sdk';
import { DEFAULT_PROBE_LIMITS, PROBE_DICTIONARY } from '../constants/probe-limits.constants';
import { CallGraphController } from '../modules/call-graph/call-graph.controller';
import { ProbeDictionaryClient } from '../modules/call-graph/probe-dictionary.client';
import { ProbeProcessService } from '../modules/call-graph/probe-process.service';
import { ProjectAnalysisService } from '../modules/call-graph/project-analysis.service';
import { ProbeSession, type ProbeEvent } from '../modules/call-graph/probe-session';

const config = vi.hoisted(() => ({ project: '' }));
vi.mock('@nest-cloud/sdk', async (original) => ({
  ...(await original<typeof import('@nest-cloud/sdk')>()),
  getConfig: (key: string) => (key === 'CallGraphProjectDirs' ? config.project : undefined),
}));

class StreamRecorder extends EventEmitter {
  events: (ProbeEvent & { seq: number })[] = [];
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  set = vi.fn();
  flushHeaders = vi.fn();
  write(line: string) {
    if (line.trim()) this.events.push(JSON.parse(line));
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit('close');
  }
  static subscribe(session: ProbeSession, after = 0) {
    const recorder = new StreamRecorder();
    session.stream(after, recorder as unknown as Response);
    return recorder;
  }
}

const routeId = 'GET /math/double';
async function createProject(root: string) {
  const router = path.join(root, 'node_modules', '@koa', 'router');
  await mkdir(router, { recursive: true });
  await mkdir(path.join(root, 'src'));
  await Promise.all([
    writeFile(path.join(root, 'package.json'), '{"type":"module"}'),
    writeFile(path.join(router, 'package.json'), '{"type":"module","main":"index.js"}'),
    // Only this HTTP router contract is needed by the test application.
    writeFile(
      path.join(router, 'index.js'),
      `
      export default class Router {
        constructor({prefix}) { this.prefix = prefix; this.routes = new Map() }
        get(path, handle) { this.routes.set('GET ' + this.prefix + path, handle) }
      }`,
    ),
    writeFile(
      path.join(root, 'src/index.ts'),
      `
      import http from 'node:http';
      import Router from '@koa/router';
      const router = new Router({prefix: '/math'});
      const double = (n: number) => n * 2;
      class MathLogic { static apply(n: number) { return double(n) } }
      router.get('/double', (n: number) => MathLogic.apply(n));
      http.createServer((req, res) => {
        const handle = router.routes.get(req.method + ' ' + req.url);
        res.end(JSON.stringify({ value: handle?.(6), inherited: !!process.env.PROBE_TEST_SECRET }));
      }).listen(0, '127.0.0.1');
    `,
    ),
  ]);
}

afterEach(() => vi.unstubAllEnvs());

describe('接口调用图服务', () => {
  it('每次启动重新读取系统字典，两个额度分别接受 0，缺少项沿用默认额度', async () => {
    const client = new ProbeDictionaryClient();
    const getItems = vi.spyOn(client, 'getItems');
    getItems.mockResolvedValueOnce(
      ResponseUtil.success([{ key: 'maxSnapshotValuesPerCall', value: '0' }]),
    );
    await expect(client.readLimits()).resolves.toEqual({
      maxCallsPerRequest: 0,
      maxSnapshotValuesPerCall: 0,
    });
    getItems.mockResolvedValueOnce(
      ResponseUtil.success([{ key: 'maxCallsPerRequest', value: 27 }]),
    );
    await expect(client.readLimits()).resolves.toEqual({
      maxCallsPerRequest: 27,
      maxSnapshotValuesPerCall: 1000,
    });
    expect(getItems.mock.calls).toEqual([[PROBE_DICTIONARY], [PROBE_DICTIONARY]]);
    for (const value of [null, false, '', -1, 2.5, '5abc', 2 ** 53]) {
      getItems.mockResolvedValueOnce(ResponseUtil.success([{ key: 'maxCallsPerRequest', value }]));
      await expect(client.readLimits()).rejects.toThrow('maxCallsPerRequest');
    }
    getItems.mockRejectedValueOnce(new Error('offline'));
    await expect(client.readLimits()).rejects.toThrow('无法读取');
  });

  it('从控制器启动项目时使用字典额度，调用和快照按各自范围截断', async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), 'call-graph-dictionary-'));
    config.project = project;
    const analysis = new ProjectAnalysisService();
    const probes = new ProbeProcessService();
    const dictionary = new ProbeDictionaryClient();
    const controller = new CallGraphController(analysis, probes, dictionary);
    const getAccount = vi.spyOn(ContextService, 'getCurrentAccount').mockReturnValue({
      accountId: 17,
      accountName: 'probe-test',
      displayName: '探针测试',
      statusVersion: 1,
      loginAt: new Date().toISOString(),
      permissionCodes: ['system:call-graph:debug'],
    });
    vi.spyOn(dictionary, 'getItems').mockResolvedValue(
      ResponseUtil.success([
        { key: 'maxCallsPerRequest', value: 2 },
        { key: 'maxSnapshotValuesPerCall', value: 1 },
      ]),
    );
    try {
      await createProject(project);
      const { data } = await controller.start({ project });
      const events = StreamRecorder.subscribe(probes.owned(17, data.sessionId)).events;
      const listening = () => events.find((e) => e.state === 'listening');
      await vi.waitFor(() => expect(listening()).toBeDefined(), { timeout: 6000 });
      const response = await fetch('http://127.0.0.1:' + listening()!.port + '/math/double');
      expect((await response.json()).value).toBe(12);
      await vi.waitFor(() =>
        expect(events.find((e) => e.type === 'end')).toMatchObject({ dropped: 1 }),
      );
      expect(events.filter((e) => e.type === 'enter')).toHaveLength(2);
      expect(events.filter((e) => e.type === 'leave').map((e) => e.result)).toEqual([
        '[已截断：本次方法调用达到 1 个值]',
        '[已截断：本次方法调用达到 1 个值]',
      ]);
    } finally {
      getAccount.mockRestore();
      await probes.onModuleDestroy();
      await analysis.onModuleDestroy();
      await rm(project, { recursive: true, force: true });
    }
  }, 15000);

  it('仅凭目录准备项目入口，按需读取计算标记并兼容旧接口范围', async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), 'call-graph-catalog-'));
    const analysis = new ProjectAnalysisService();
    config.project = project;
    try {
      await createProject(project);
      await writeFile(
        path.join(project, 'src/second.ts'),
        "import Router from '@koa/router'; const router = new Router(); router.get('/check/:id', () => 1);",
      );
      const target = await analysis.target(project);
      expect(target.routes.map((r) => r.id).sort()).toEqual(['GET /check/:id', routeId]);
      expect(target.computations(routeId)).toBeUndefined();
      const graph = await analysis.graph(project, routeId);
      expect(target.computations(routeId)?.has(graph.roots[0])).toBe(true);
      expect(target.computations('GET /check/:id')).toBeUndefined();
      const legacy = await analysis.target(project, routeId);
      expect(legacy.routes.map((r) => r.id)).toEqual([routeId]);
      await expect(analysis.target(project, 'GET /missing')).rejects.toThrow('接口不存在');
    } finally {
      await analysis.onModuleDestroy();
      await rm(project, { recursive: true, force: true });
    }
  });

  it('限制可分析目录，扫描结果与子进程事件使用同一节点，并按账号控制启停和回放', async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), 'call-graph-service-'));
    const analysis = new ProjectAnalysisService();
    const probes = new ProbeProcessService();
    const owner = 17;
    config.project = project;
    vi.stubEnv('PROBE_TEST_SECRET', 'unavailable-to-target');
    try {
      await createProject(project);
      await expect(analysis.scan('.')).rejects.toThrow('绝对目录');
      await expect(analysis.scan(path.join(project, 'src'))).rejects.toThrow('未列入');
      expect(() => analysis.graph(project, routeId)).toThrow('重新扫描');
      const catalog = await analysis.scan(project);
      expect(catalog).toMatchObject({ framework: 'koa', entry: 'src/index.ts' });
      expect(catalog.routes.map((route) => route.id)).toEqual([routeId]);
      expect(() => analysis.graph(project, 'GET /unknown')).toThrow('接口不存在');
      const graph = await analysis.graph(project, routeId);
      const method = graph.nodes.find((node) => node.name === 'double');
      expect(method?.anonymous).toBe(false);
      expect(method?.computationOnly).toBe(true);
      const wrapper = graph.nodes.find((node) => node.name === 'MathLogic.apply');
      expect(wrapper?.computationOnly).toBe(true);
      expect(graph.nodes.find((node) => node.id === graph.roots[0])?.anonymous).toBe(true);
      const target = await analysis.target(project, routeId);
      const { sessionId } = probes.start(owner, target, DEFAULT_PROBE_LIMITS);
      expect(() => probes.start(owner, target, DEFAULT_PROBE_LIMITS)).toThrow('已有探针');
      expect(() => probes.owned(owner + 1, sessionId)).toThrow('会话不存在');
      await expect(probes.stop(owner + 1, sessionId)).rejects.toThrow('会话不存在');
      const session = probes.owned(owner, sessionId);
      const live = StreamRecorder.subscribe(session);
      const listening = () => live.events.find((e) => e.state === 'listening');
      await vi.waitFor(() => expect(listening()).toBeDefined(), { timeout: 6000 });
      const origin = 'http://127.0.0.1:' + listening()!.port;
      const response = await fetch(origin + '/math/double');
      expect(await response.json()).toEqual({ value: 12, inherited: false });
      await vi.waitFor(() => expect(live.events.some((e) => e.type === 'end')).toBe(true));
      const trace = live.events.filter((e) => e.type === 'enter');
      expect(trace.map((e) => e.node)).toEqual([
        expect.objectContaining({ id: graph.roots[0], anonymous: true, computationOnly: true }),
        expect.objectContaining({ id: wrapper!.id, anonymous: false, computationOnly: true }),
        expect.objectContaining({ id: method!.id, anonymous: false, computationOnly: true }),
      ]);
      expect(trace[1].parentId).toBe(trace[0].callId);
      expect(trace[1].args).toEqual([{ name: 'n', value: 6 }]);
      expect(live.events).toContainEqual(
        expect.objectContaining({
          type: 'leave',
          callId: trace[1].callId,
          requestId: trace[1].requestId,
          result: 12,
          durationMs: expect.any(Number),
        }),
      );
      await probes.stop(owner, sessionId);
      expect(live.events.at(-1)).toMatchObject({ state: 'stopped' });
      expect(live.writableEnded).toBe(true);
      await expect(fetch(origin + '/math/double')).rejects.toThrow('fetch failed');
      const replay = StreamRecorder.subscribe(probes.owned(owner, sessionId), trace[0].seq);
      expect(replay.events).toEqual(live.events.filter((e) => e.seq > trace[0].seq));
      expect(replay.writableEnded).toBe(true);
      // Abnormal target exit frees the slot and keeps the failure visible on reconnect.
      await writeFile(path.join(project, 'src/index.ts'), 'process.exit(23)');
      const next = probes.start(owner, target, DEFAULT_PROBE_LIMITS);
      const failed = StreamRecorder.subscribe(probes.owned(owner, next.sessionId));
      await vi.waitFor(
        () =>
          expect(failed.events.at(-1)).toMatchObject({
            state: 'error',
            message: expect.stringContaining('23'),
          }),
        { timeout: 6000 },
      );
    } finally {
      await probes.onModuleDestroy();
      await analysis.onModuleDestroy();
      await rm(project, { recursive: true, force: true });
    }
  }, 20000);

  it('回放窗口淘汰旧游标，已断开的订阅释放连接名额', () => {
    const session = new ProbeSession(5);
    for (let i = 0; i < 12002; i++) session.publish({ type: 'enter' });
    expect(() => StreamRecorder.subscribe(session, 0)).toThrow('历史事件已过期');
    expect(() => StreamRecorder.subscribe(session, 13000)).toThrow('游标无效');
    const readers = Array.from({ length: 4 }, () => StreamRecorder.subscribe(session, 12001));
    try {
      expect(() => StreamRecorder.subscribe(session, 12001)).toThrow('连接数达到上限');
      readers[0].end();
      const latest = StreamRecorder.subscribe(session, 12001);
      session.finish('stopped', '已停止');
      expect(latest.events.map((e) => e.seq)).toEqual([12002, 12003]);
      expect(latest.writableEnded).toBe(true);
    } finally {
      session.finish('stopped', '已停止');
    }
  });

  it('在线订阅背压跨过回放窗口时仍可依序读完，包括最终停止状态', () => {
    const session = new ProbeSession(5);
    const client = StreamRecorder.subscribe(session);
    const write = client.write.bind(client);
    vi.spyOn(client, 'write').mockImplementationOnce((line: string) => {
      write(line);
      return false;
    });
    for (let i = 1; i <= 16002; i++) session.publish({ type: 'enter', callId: String(i) });
    session.finish('stopped', '已停止');
    expect(client.events.map((e) => e.seq)).toEqual([1]);
    expect(client.writableEnded).toBe(false);
    expect(() => StreamRecorder.subscribe(session, 1)).toThrow('历史事件已过期');
    client.emit('drain');
    expect(client.events.length).toBe(16003);
    expect(client.events.every((e, index) => e.seq === index + 1)).toBe(true);
    expect(client.events.at(-2)).toMatchObject({ type: 'enter', callId: '16002' });
    expect(client.events.at(-1)).toMatchObject({ type: 'status', state: 'stopped' });
    expect(client.writableEnded).toBe(true);
  });
});
