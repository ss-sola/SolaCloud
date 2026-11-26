import { ProjectException } from '@nest-cloud/sdk';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProbeSession, type ProbeEvent } from './probe-session';
import { runtimePath } from './project-analysis.service';
import type { ProbeLimits } from '../../constants/probe-limits.constants';
import type { ProbeTarget } from './types';
import { ProbeQueueRelay } from './probe-queue-relay';

const STARTUP_TIMEOUT_MS = 60_000;
const SESSION_LIMIT_MS = 30 * 60_000;
const REPLAY_TTL_MS = 5 * 60_000;
const STOP_TIMEOUT_MS = 4_000;
const STARTUP_OUTPUT_TAIL_LENGTH = 256;
// Report recognized causes as fixed text. Target logs can contain credentials or connection URLs.
const STARTUP_FAILURE_HINTS = [
  [
    /\b(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)\b|Cannot find (?:module|package)/i,
    '缺少启动所需的模块或依赖包',
  ],
  [
    /\bERR_(?:UNKNOWN_FILE_EXTENSION|UNSUPPORTED_TYPESCRIPT_SYNTAX)\b/,
    'Node 无法加载目标入口，请检查构建产物和 Node 版本',
  ],
  [/\bEADDRINUSE\b/, '目标监听端口被占用（EADDRINUSE）'],
  [/\bEADDRNOTAVAIL\b/, '目标监听地址在当前主机不可用（EADDRNOTAVAIL）'],
  [/\bECONNREFUSED\b/, '依赖服务拒绝连接（ECONNREFUSED）'],
  [/\b(?:ETIMEDOUT|ESOCKETTIMEDOUT)\b/, '连接依赖服务超时'],
  [/\b(?:ENOTFOUND|EAI_AGAIN)\b/, '依赖服务地址解析失败'],
  [/\b(?:EACCES|EPERM)\b/, '目标进程缺少所需的系统权限'],
  [/\bENOENT\b/, '目标进程所需的文件或程序不存在（ENOENT）'],
  [
    /\b(?:WRONGPASS|NOAUTH|28P01)\b|password authentication failed/i,
    '依赖服务认证失败，请检查目标项目的连接配置',
  ],
  [
    /配置(?:校验|验证)失败|\bconfig(?:uration)? validation (?:failed|error)\b/i,
    '目标项目配置校验失败',
  ],
  [/\bSyntaxError\b/, '目标项目加载时出现语法错误（SyntaxError）'],
] as const;
const TRACE_EVENTS = new Set(['request', 'requestParams', 'enter', 'leave', 'end']);
const HOST_ENV =
  /^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|home|userprofile|localappdata|appdata|lang|lc_all|tz)$/i;

@Injectable()
export class ProbeProcessService implements OnModuleDestroy {
  private session?: ProbeSession;
  private child?: ChildProcess;
  private readonly workers = new Set<ChildProcess>();
  private timeout?: NodeJS.Timeout;
  private expiration?: NodeJS.Timeout;
  private exited?: Promise<void>;

  start(
    owner: number,
    {
      project,
      framework,
      entry: declaredEntry,
      workerEntries = [],
      routes,
      computations,
    }: ProbeTarget,
    limits: ProbeLimits,
  ) {
    if (this.child || this.workers.size)
      throw new ProjectException('已有探针占用实例，请先停止该会话', 409);
    const candidate = path.resolve(project, declaredEntry);
    function assertInside(candidatePath: string) {
      const relative = path.relative(project, candidatePath);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        throw new ProjectException('启动入口超出所选项目目录', 403);
    }
    assertInside(candidate);
    let entry: string;
    try {
      entry = realpathSync(candidate);
    } catch {
      throw new ProjectException(
        framework === 'nestjs'
          ? '未找到 NestJS 构建入口 ' + declaredEntry + '，请先按项目配置构建后再启动探针'
          : '未找到 Koa 项目入口 ' + declaredEntry,
        422,
      );
    }
    assertInside(entry);
    if (!statSync(entry, { throwIfNoEntry: false })?.isFile())
      throw new ProjectException('项目入口 ' + declaredEntry + ' 不存在或不是文件', 422);
    if (framework === 'nestjs' && !/\.[cm]?js$/i.test(entry))
      throw new ProjectException(
        'NestJS 探针需要已构建的 JavaScript 入口，请先按项目配置构建',
        422,
      );
    clearTimeout(this.expiration);
    const session = new ProbeSession(owner);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => HOST_ENV.test(key)),
    );
    const spawn = (filename: string, output: 'inherit' | 'pipe' = 'inherit') =>
      fork(filename, [], {
        cwd: project,
        execArgv: ['--import', pathToFileURL(runtimePath('probe.mjs')).href],
        env: { ...env, NODE_ENV: 'development', SOLA_CALL_GRAPH_PROJECT: '1' },
        stdio: ['ignore', output, output, 'ipc'],
        windowsHide: true,
      });
    const child = spawn(entry, 'pipe');
    this.session = session;
    this.child = child;
    session.publish({ type: 'status', state: 'starting' });
    let listening = false;
    let startupHint: string | undefined;
    function failureMessage(message: string, hint = startupHint) {
      return [message, hint, '完整启动日志见服务终端。'].filter(Boolean).join(' ');
    }
    const startupTimeout = setTimeout(() => {
      if (session.closed) return;
      void this.terminate(
        failureMessage(`启动超时，目标项目在 ${STARTUP_TIMEOUT_MS / 1000} 秒内未监听 HTTP 端口。`),
        'error',
      );
    }, STARTUP_TIMEOUT_MS);
    startupTimeout.unref();
    for (const [stream, destination] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ] as const) {
      if (!stream) continue;
      let tail = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        if (listening || session.closed) return;
        const output = tail + chunk;
        startupHint =
          STARTUP_FAILURE_HINTS.find(([pattern]) => pattern.test(output))?.[1] ?? startupHint;
        tail = output.slice(-STARTUP_OUTPUT_TAIL_LENGTH);
      });
      stream.pipe(destination, { end: false });
    }
    const relay = new ProbeQueueRelay((event) => session.publish(event));
    function publish(raw: unknown, fromWorker: boolean) {
      if (session.closed || typeof raw !== 'object' || !raw || !('type' in raw)) return;
      const event = raw as ProbeEvent;
      if (event.type === 'listening' && !fromWorker && Number.isInteger(event.port)) {
        listening = true;
        clearTimeout(startupTimeout);
        session.publish({ type: 'status', state: 'listening', port: event.port });
      } else if (event.type === 'warning' && typeof event.message === 'string') {
        session.publish({ type: 'warning', message: event.message });
      } else if (TRACE_EVENTS.has(event.type)) {
        if (
          event.type === 'enter' &&
          event.node &&
          typeof event.node === 'object' &&
          'id' in event.node
        ) {
          const known = computations(
            String(event.routeId ?? (routes.length === 1 ? routes[0].id : '')),
          );
          if (known)
            event.node = { ...event.node, computationOnly: known.has(String(event.node.id)) };
        }
        relay.accept(event);
      }
    }
    function receive(proc: ChildProcess, fromWorker: boolean) {
      proc.on('message', (raw: unknown) => {
        if (
          raw &&
          typeof raw === 'object' &&
          'type' in raw &&
          raw.type === 'events' &&
          'events' in raw &&
          Array.isArray(raw.events)
        ) {
          for (const event of raw.events) publish(event, fromWorker);
        } else publish(raw, fromWorker);
      });
    }
    receive(child, false);
    const httpExited = new Promise<void>((resolve) => {
      let drainTimeout: ReturnType<typeof setTimeout> | undefined;
      child.once('error', (error) => {
        const hint = STARTUP_FAILURE_HINTS.find(([pattern]) => pattern.test(error.message))?.[1];
        session.finish('error', failureMessage('无法启动目标进程。', hint));
      });
      child.once('exit', () => {
        clearTimeout(startupTimeout);
        // Descendants can keep the target's output pipes open after it exits.
        drainTimeout = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
        }, STOP_TIMEOUT_MS);
        drainTimeout.unref();
      });
      child.once('close', (code, signal) => {
        clearTimeout(drainTimeout);
        clearTimeout(startupTimeout);
        clearTimeout(this.timeout);
        if (!session.closed) {
          const outcome = '（' + (signal ?? code) + '）';
          session.finish(
            'error',
            listening
              ? '目标进程已退出' + outcome + '，请查看服务终端。'
              : failureMessage('目标进程在监听前退出' + outcome + '。'),
          );
        }
        this.child = undefined;
        for (const background of this.workers) {
          if (background.killed) continue;
          background.kill('SIGTERM');
          const force = setTimeout(() => background.kill('SIGKILL'), STOP_TIMEOUT_MS);
          force.unref();
          background.once('close', () => clearTimeout(force));
        }
        this.expiration = setTimeout(() => {
          if (this.session === session) this.session = undefined;
        }, REPLAY_TTL_MS);
        this.expiration.unref();
        resolve();
      });
    });
    this.timeout = setTimeout(() => {
      void this.terminate('已到达会话时限');
    }, SESSION_LIMIT_MS);
    this.timeout.unref();
    // The project catalog can exceed the maximum Windows environment size.
    const queueKey = randomUUID();
    child.send({ type: 'configure', framework, entry, routes, limits, queueKey }, (error) => {
      if (error && !session.closed) {
        session.finish('error', '探针未能接收路由配置');
        child.kill();
      }
    });
    const workerExits: Promise<void>[] = [];
    const startedEntries = new Set([entry]);
    for (const workerEntry of workerEntries) {
      const warn = (message: string) =>
        session.publish({ type: 'warning', message: '独立 Worker ' + workerEntry + ' ' + message });
      let backgroundEntry: string;
      let worker: ChildProcess;
      try {
        const workerPath = path.resolve(project, workerEntry);
        assertInside(workerPath);
        backgroundEntry = realpathSync(workerPath);
        assertInside(backgroundEntry);
        if (startedEntries.has(backgroundEntry)) continue;
        const extension = framework === 'nestjs' ? /\.[cm]?js$/i : /\.[cm]?[jt]s$/i;
        if (!extension.test(backgroundEntry) || !statSync(backgroundEntry)?.isFile()) {
          warn('入口已失效，请重新扫描项目。');
          continue;
        }
        worker = spawn(backgroundEntry);
      } catch {
        warn('无法启动，请检查入口并重新扫描项目。');
        continue;
      }
      startedEntries.add(backgroundEntry);
      this.workers.add(worker);
      receive(worker, true);
      workerExits.push(
        new Promise<void>((resolve) => {
          worker.once('error', () => warn('启动失败，请查看服务终端。'));
          worker.once('close', (code, signal) => {
            this.workers.delete(worker);
            warn('已退出（' + (signal ?? code) + '）。');
            resolve();
          });
        }),
      );
      worker.send(
        {
          type: 'configure',
          framework,
          entry: backgroundEntry,
          routes,
          limits,
          queueKey,
          workerOnly: true,
        },
        (error) => {
          if (error) {
            warn('未能接收探针配置。');
            worker.kill();
          }
        },
      );
    }
    this.exited = Promise.all([httpExited, ...workerExits]).then(() => undefined);
    return { sessionId: session.id };
  }

  owned(owner: number, sessionId: string) {
    if (this.session?.id !== sessionId || this.session.owner !== owner)
      throw new ProjectException('探针会话不存在或已过期', 404);
    return this.session;
  }

  async stop(owner: number, id: string) {
    this.owned(owner, id);
    await this.terminate('探针已停止');
    return { ok: true };
  }

  private async terminate(message: string, state: 'stopped' | 'error' = 'stopped') {
    const processes = [this.child, ...this.workers].filter((child) => child !== undefined);
    if (!processes.length) return;
    this.session?.finish(state, message);
    for (const child of processes) child.kill('SIGTERM');
    const force = setTimeout(() => {
      for (const child of processes) {
        child.kill('SIGKILL');
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    }, STOP_TIMEOUT_MS);
    try {
      await this.exited;
    } finally {
      clearTimeout(force);
    }
  }
  async onModuleDestroy() {
    await this.terminate('服务已关闭');
    clearTimeout(this.expiration);
  }
}
