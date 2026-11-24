import { ProjectException } from '@nest-cloud/sdk';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { fork, type ChildProcess } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProbeSession, type ProbeEvent } from './probe-session';
import { runtimePath } from './project-analysis.service';
import type { ProbeLimits } from '../../constants/probe-limits.constants';
import type { ProbeTarget } from './types';

const SESSION_LIMIT_MS = 30 * 60_000;
const REPLAY_TTL_MS = 5 * 60_000;
const STOP_TIMEOUT_MS = 4_000;
const TRACE_EVENTS = new Set(['request', 'enter', 'leave', 'end']);
const HOST_ENV =
  /^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|home|userprofile|localappdata|appdata|lang|lc_all|tz)$/i;

@Injectable()
export class ProbeProcessService implements OnModuleDestroy {
  private session?: ProbeSession;
  private child?: ChildProcess;
  private timeout?: NodeJS.Timeout;
  private expiration?: NodeJS.Timeout;
  private exited?: Promise<void>;

  start(
    owner: number,
    { project, framework, entry: declaredEntry, routes, computations }: ProbeTarget,
    limits: ProbeLimits,
  ) {
    if (this.child) throw new ProjectException('已有探针占用实例，请先停止该会话', 409);
    const candidate = path.resolve(project, declaredEntry);
    function assertInside(candidatePath: string) {
      const relative = path.relative(project, candidatePath);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        throw new ProjectException('项目入口超出配置目录', 403);
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
    const child = fork(entry, [], {
      cwd: project,
      execArgv: ['--import', pathToFileURL(runtimePath('probe.mjs')).href],
      env: { ...env, NODE_ENV: 'development', SOLA_CALL_GRAPH_PROJECT: '1' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    });
    this.session = session;
    this.child = child;
    session.publish({ type: 'status', state: 'starting' });
    function publish(raw: unknown) {
      if (session.closed || typeof raw !== 'object' || !raw || !('type' in raw)) return;
      const event = raw as ProbeEvent;
      if (event.type === 'listening' && Number.isInteger(event.port)) {
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
        session.publish(event);
      }
    }
    child.on('message', (raw: unknown) => {
      if (
        raw &&
        typeof raw === 'object' &&
        'type' in raw &&
        raw.type === 'events' &&
        'events' in raw &&
        Array.isArray(raw.events)
      ) {
        for (const event of raw.events) publish(event);
      } else publish(raw);
    });
    this.exited = new Promise<void>((resolve) => {
      child.once('error', () => session.finish('error', '无法启动目标进程，请查看服务终端'));
      child.once('close', (code, signal) => {
        clearTimeout(this.timeout);
        if (!session.closed)
          session.finish(
            'error',
            '目标进程已退出（' + (signal ?? code) + '），请查看服务终端中的启动日志',
          );
        this.child = undefined;
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
    child.send({ type: 'configure', framework, entry, routes, limits }, (error) => {
      if (error && !session.closed) {
        session.finish('error', '探针未能接收路由配置');
        child.kill();
      }
    });
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

  private async terminate(message: string) {
    const child = this.child;
    if (!child) return;
    this.session?.finish('stopped', message);
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
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
