import { ProjectException } from '@nest-cloud/sdk';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { opendirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Catalog, Graph, ProbeRoute, ProbeTarget } from './types';

export const runtimePath = (file: string) => path.resolve(__dirname, '../../../runtime', file);

class AnalysisWorker {
  readonly thread: Worker;
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (err: Error) => void }
  >();
  private failed = false;
  constructor(readonly project: string) {
    this.thread = new Worker(runtimePath('analyze-worker.mjs'), { workerData: project });
    this.thread.on('message', ({ id, value, error }) => {
      const task = this.pending.get(id);
      this.pending.delete(id);
      if (error) task?.reject(new ProjectException(error, 422));
      else task?.resolve(value);
    });
    this.thread.once('error', () => this.closePending());
    this.thread.once('exit', () => this.closePending());
  }
  private closePending() {
    this.failed = true;
    for (const task of this.pending.values())
      task.reject(new ProjectException('分析线程已退出，请重新扫描', 503));
    this.pending.clear();
  }
  get busy() {
    return this.pending.size > 0;
  }
  async request<T>(routeId?: string, probeRoutes = false): Promise<T> {
    if (this.failed) throw new ProjectException('分析线程已退出，请重新扫描', 503);
    if (this.pending.size >= 8) throw new ProjectException('分析请求较多，请稍后重试', 429);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (result) => resolve(result as T), reject });
      this.thread.postMessage({ id, routeId, probeRoutes });
    });
  }
  close() {
    this.closePending();
    return this.thread.terminate();
  }
}

@Injectable()
export class ProjectAnalysisService implements OnModuleDestroy {
  private worker?: AnalysisWorker;
  private catalog?: Catalog;
  private probeRoutes?: Promise<ProbeRoute[]>;
  private readonly graphs = new Map<string, Promise<Graph>>();
  private computations = new Map<string, ReadonlySet<string>>();

  resolveProject(input: string) {
    if (!path.isAbsolute(input)) throw new ProjectException('请输入服务所在机器上的绝对目录', 400);
    try {
      const project = realpathSync(input);
      opendirSync(project).closeSync();
      return project;
    } catch {
      throw new ProjectException('请输入存在且服务可读取的项目目录', 400);
    }
  }

  async scan(input: string): Promise<Catalog> {
    const project = this.resolveProject(input);
    if (this.worker?.busy) throw new ProjectException('正在分析项目，请稍后再扫描', 409);
    const previous = this.worker;
    this.catalog = undefined;
    this.probeRoutes = undefined;
    this.computations = new Map();
    this.graphs.clear();
    // 先占用新槽位，防止并行扫描在等待旧线程退出时覆盖彼此。
    const worker = new AnalysisWorker(project);
    this.worker = worker;
    if (previous) void previous.close();
    this.catalog = await worker.request<Catalog>();
    return this.catalog;
  }
  graph(input: string, routeId: string): Promise<Graph> {
    const project = this.resolveProject(input);
    if (this.worker?.project !== project || !this.catalog)
      throw new ProjectException('请重新扫描该项目', 409);
    if (!this.catalog.routes.some((route) => route.id === routeId))
      throw new ProjectException('接口不存在，请重新扫描', 404);
    const cached = this.graphs.get(routeId);
    if (cached) return cached;
    if (this.graphs.size >= 12) {
      const oldest = this.graphs.keys().next().value!;
      this.graphs.delete(oldest);
      this.computations.delete(oldest);
    }
    const result = this.worker.request<Graph>(routeId).then((graph) => {
      if (this.graphs.get(routeId) === result) {
        this.computations.set(
          routeId,
          new Set(graph.nodes.filter((n) => n.computationOnly).map((n) => n.id)),
        );
      }
      return graph;
    });
    this.graphs.set(routeId, result);
    void result.catch(() => {
      if (this.graphs.get(routeId) === result) this.graphs.delete(routeId);
    });
    return result;
  }
  async target(input: string, routeId?: string): Promise<ProbeTarget> {
    const project = this.resolveProject(input);
    if (this.worker?.project !== project || !this.catalog) await this.scan(input);
    const worker = this.worker;
    if (!worker || worker.project !== project || !this.catalog)
      throw new ProjectException('项目已切换，请重新扫描', 409);
    const { framework, entry, workerEntries } = this.catalog;
    if (framework !== 'koa' && framework !== 'nestjs')
      throw new ProjectException('无法识别项目框架。当前探针支持 Koa 和 NestJS HTTP 项目。', 422);
    if (!entry)
      throw new ProjectException(
        framework === 'nestjs'
          ? '未识别 NestJS 构建入口，请先按项目配置构建后重新扫描'
          : '未识别 Koa 启动入口，请检查项目入口后重新扫描',
        422,
      );
    if (!this.catalog.routes.length) throw new ProjectException('项目没有可跟踪的接口', 422);
    let routes: ProbeRoute[];
    if (routeId) {
      // Preserve a legacy single-route consumer's event scope.
      const route = this.catalog.routes.find((item) => item.id === routeId);
      if (!route) throw new ProjectException('接口不存在，请重新扫描', 404);
      const graph = await this.graph(input, routeId);
      routes = [{ id: route.id, method: route.method, path: route.path, roots: graph.roots }];
    } else {
      const pending = (this.probeRoutes ??= worker.request<ProbeRoute[]>(undefined, true));
      try {
        routes = await pending;
      } catch (error) {
        if (this.probeRoutes === pending) this.probeRoutes = undefined;
        throw error;
      }
    }
    if (this.worker !== worker) throw new ProjectException('项目已切换，请重新扫描', 409);
    const snapshot = this.computations;
    return {
      project,
      framework,
      entry,
      workerEntries,
      routes,
      computations: (id: string) =>
        (this.worker?.project === project ? this.computations : snapshot).get(id),
    };
  }
  async onModuleDestroy() {
    await this.worker?.close();
  }
}
