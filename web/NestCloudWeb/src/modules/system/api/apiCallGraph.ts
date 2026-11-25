import { ApiClient } from '../../../shared/api/apiClient';

export interface ProjectRoute {
  id: string;
  method: string;
  path: string;
  file: string;
  line: number;
}

export interface MethodNode {
  id: string;
  name: string;
  file: string;
  line: number;
  anonymous?: boolean;
  computationOnly?: boolean;
}

export interface MethodGraph {
  nodes: MethodNode[];
  roots: string[];
  edges: { from: string; to: string }[];
  warnings: string[];
}

export interface RouteCatalog {
  framework?: 'koa' | 'nestjs' | 'unknown';
  entry?: string;
  routes: ProjectRoute[];
  warnings: string[];
}

export interface RequestParameters {
  path?: unknown;
  query?: unknown;
  body?: unknown;
}

export type AgentEvent = { seq: number } & (
  | { type: 'warning'; message: string }
  | {
      type: 'status';
      state: 'starting' | 'listening' | 'stopped' | 'error';
      message?: string;
      port?: number;
    }
  | {
      type: 'request';
      requestId: string;
      routeId?: string;
      method: string;
      path: string;
      startedAt: number;
      requestHeaders?: unknown;
      parameters?: RequestParameters;
    }
  | { type: 'requestParams'; requestId: string; parameters: RequestParameters }
  | {
      type: 'enter';
      requestId: string;
      callId: string;
      parentId: string | null;
      node: MethodNode;
      args: unknown;
    }
  | {
      type: 'leave';
      requestId: string;
      callId: string;
      durationMs: number;
      result: unknown;
      state: 'ok' | 'error';
    }
  | {
      type: 'end';
      requestId: string;
      status: number;
      durationMs: number;
      dropped: number;
      parameters?: RequestParameters;
      responseHeaders?: unknown;
      responseBody?: unknown;
    }
);

const prefix = '/api/call-graph';

function post<T>(path: string, body: object, signal?: AbortSignal) {
  return ApiClient.request<T>(prefix + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    keepalive: path === '/stop',
  });
}

export const ApiCallGraph = {
  scan: (project: string, signal: AbortSignal) => post<RouteCatalog>('/scan', { project }, signal),
  graph: (project: string, routeId: string, signal: AbortSignal) =>
    post<MethodGraph>('/graph', { project, routeId }, signal),
  start: (project: string) => post<{ sessionId: string }>('/start', { project }),
  stop: (sessionId: string) => post<{ ok: true }>('/stop', { sessionId }),
  async events(
    sessionId: string,
    after: number,
    signal: AbortSignal,
    onEvent: (event: AgentEvent, live: boolean) => void,
  ) {
    const url = ApiClient.buildUrl(prefix + '/events', { sessionId, after });
    const response = await fetch(url, { signal, credentials: 'include', cache: 'no-store' });
    if (response.status === 410)
      throw new Error('较早的探针事件已过期，无法继续回放。请停止探针并开始新的采集。');
    if (!response.ok || response.headers.get('Content-Type')?.includes('application/json')) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || '无法读取探针事件，HTTP ' + response.status);
    }
    if (!response.body) throw new Error('浏览器未取得探针事件流。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let live = false;
    try {
      while (!signal.aborted) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = pending.split('\n');
        pending = chunk.done ? '' : (lines.pop() ?? '');
        for (const line of lines) {
          if (line.trim()) onEvent(JSON.parse(line) as AgentEvent, live);
          else live = true;
        }
        if (chunk.done) break;
      }
    } finally {
      reader.releaseLock();
    }
  },
};
