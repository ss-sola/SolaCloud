import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { Server as HttpServer } from 'node:http';
import { Server as HttpsServer } from 'node:https';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { isMainThread } from 'node:worker_threads';
import { types } from 'node:util';
import { installSourceHook } from './probe-source.mjs';
import { installNestSourceHook } from './probe-nest-source.mjs';
import { SNAPSHOT_VALUES_PER_CALL, isKoaContext, koaBody, snapshot } from './probe-snapshot.mjs';
import { createRouteMatcher, matchRouteRoot } from './probe-routes.mjs';

const LIMIT = { args: 20, requests: 12 };
const EVENTS_PER_PACKET = 32;
const context = new AsyncLocalStorage();
const runtimeKey = Symbol.for('solacloud.api-call-graph');

// A tight synchronous loop can produce events faster than IPC callbacks run.
// Keep their order and drain in packets without changing the business method's return type.
function projectSender() {
  let head, tail;
  let writing = false;
  let scheduled = false;
  function flush() {
    scheduled = false;
    if (writing || !head || !process.connected) return;
    const batch = head.events;
    head = head.next;
    if (!head) tail = undefined;
    writing = true;
    process.send({ type: 'events', events: batch }, (error) => {
      writing = false;
      if (!error) flush();
      else if (process.connected) process.disconnect();
    });
  }
  return (event) => {
    if (!process.connected) return;
    if (!tail || tail.events.length === EVENTS_PER_PACKET) {
      const packet = { events: [], next: undefined };
      if (tail) tail.next = packet;
      else head = packet;
      tail = packet;
    }
    tail.events.push(event);
    if (!writing && !scheduled) {
      scheduled = true;
      setImmediate(flush);
    }
  };
}

function capture(value, budget, field) {
  try {
    return snapshot(value, budget, field);
  } catch {
    return '[无法快照]';
  }
}

function announce(trace, route, send) {
  if (trace.route) return;
  trace.route = route;
  send({
    type: 'request',
    requestId: trace.id,
    routeId: route.id,
    method: trace.method,
    path: trace.pathname,
    startedAt: trace.startedAt,
  });
}

function createObserver(send, legacy, limits) {
  const callLimit = limits.maxCallsPerRequest || Infinity;
  const valueLimit = (limits.maxSnapshotValuesPerCall ?? SNAPSHOT_VALUES_PER_CALL) || Infinity;
  /** 每次实际调用单独计时；并发分支通过异步上下文保留自己的父节点。 */
  function invoke(meta, args, execute, locals = []) {
    const parent = context.getStore();
    if (!parent || parent.trace.closed) return execute(...locals);
    const { trace } = parent;
    if (!parent.inHandler) {
      if (trace.route) {
        if (!(legacy && !trace.route.roots.size) && !trace.route.roots.has(meta.id))
          return execute(...locals);
      } else {
        const ctx = args[0];
        const matched = trace.nestRequest
          ? Object.getOwnPropertyDescriptor(
              Object.getOwnPropertyDescriptor(trace.nestRequest, 'route')?.value ?? {},
              'path',
            )?.value
          : isKoaContext(ctx) && Object.getOwnPropertyDescriptor(ctx, '_matchedRoute')?.value;
        const route = matchRouteRoot(trace.candidates, meta.id, matched || undefined);
        if (!route) return execute(...locals);
        announce(trace, route, send);
      }
    }
    if (trace.count >= callLimit) {
      trace.dropped++;
      // A later route middleware may be a new root even after the budget runs out.
      // Its descendants still count, while code outside any root stays excluded.
      if (parent.inHandler) return execute(...locals);
      return context.run({ trace, inHandler: true }, execute, ...locals);
    }
    const requestId = trace.id;
    const callId = String(++trace.count);
    const budget = { left: valueLimit, limit: valueLimit };
    const values = [];
    for (let i = 0; i < Math.min(args.length, LIMIT.args); i++) {
      const name =
        (meta.rest && i >= meta.params.length - 1 ? meta.params.at(-1) : meta.params[i]) ??
        '#' + (i + 1);
      values.push({ name, value: capture(args[i], budget, name) });
    }
    if (args.length > LIMIT.args) values.push({ name: '…', value: '[已截断]' });
    const node = {
      id: meta.id,
      name: meta.name,
      file: meta.file,
      line: meta.line,
      anonymous: meta.anonymous,
    };
    send({
      type: 'enter',
      requestId,
      routeId: trace.route.id,
      callId,
      parentId: parent.callId,
      node,
      args: values,
    });
    const start = performance.now();
    function finish(state, value) {
      if (trace.closed) return;
      const durationMs = performance.now() - start;
      let result = capture(value, budget, state === 'ok' ? meta.name : '');
      // 微助教通过 ctx.body 返回响应，处理器通常仅返回 Promise<void>。
      if (state === 'ok' && value === undefined) {
        try {
          if (isKoaContext(args[0])) {
            result = {
              returnValue: result,
              responseBody: capture(koaBody(args[0]), budget, ''),
            };
          }
        } catch {
          /* 业务对象可能在执行过程中失效。 */
        }
      }
      send({ type: 'leave', requestId, callId, durationMs, result, state });
    }
    let result;
    try {
      result = context.run({ trace, callId, inHandler: true }, execute, ...locals);
    } catch (error) {
      finish('error', error);
      throw error;
    }
    if (types.isPromise(result)) {
      try {
        Promise.prototype.then.call(
          result,
          (value) => finish('ok', value),
          (error) => finish('error', error),
        );
      } catch {
        // 自定义 Promise 可能禁止派生观察者，保持业务实际拿到的返回值。
        trace.dropped++;
      }
    } else {
      finish('ok', result);
    }
    return result;
  }
  return {
    invoke,
    observe(meta, fn) {
      if (!fn.name && meta.inferredName)
        Object.defineProperty(fn, 'name', { configurable: true, value: meta.inferredName });
      return new Proxy(fn, {
        apply(target, receiver, args) {
          return invoke(meta, args, () => Reflect.apply(target, receiver, args));
        },
      });
    },
  };
}

function install(routes, legacy, limits = {}, framework, entry) {
  const matchRequest = createRouteMatcher(routes, framework);
  const send = legacy
    ? (event) => {
        if (process.connected) process.send(event);
      }
    : projectSender();
  Object.defineProperty(globalThis, runtimeKey, { value: createObserver(send, legacy, limits) });
  let active = 0;
  function observeServer(prototype) {
    const original = prototype.emit;
    prototype.emit = function emit(event, ...args) {
      const dispatch = () => Reflect.apply(original, this, [event, ...args]);
      if (event === 'listening') {
        const address = this.address();
        if (address?.port && process.connected)
          process.send({ type: 'listening', port: address.port });
      }
      if (event !== 'request') return dispatch();
      const [req, res] = args;
      const override = req.headers['x-http-method-override'];
      const method = typeof override === 'string' && override ? override.toUpperCase() : req.method;
      const pathname = req.url.split('?', 1)[0];
      if (active >= LIMIT.requests) return dispatch();
      const candidates = matchRequest(method, pathname);
      if (!candidates.length) return dispatch();
      const trace = {
        id: randomUUID(),
        start: performance.now(),
        startedAt: Date.now(),
        candidates,
        nestRequest: framework === 'nestjs' ? req : undefined,
        method,
        pathname,
        count: 0,
        dropped: 0,
        closed: false,
      };
      active++;
      // For overlapping templates, the handler chosen by the router identifies
      // the route. Unambiguous paths can show a running request immediately.
      if (candidates.length === 1) announce(trace, candidates[0], send);
      function end() {
        res.off('finish', end);
        res.off('close', end);
        const durationMs = performance.now() - trace.start;
        // 先收集请求处理器在当前微任务队列里的最终返回值。
        setImmediate(() => {
          trace.closed = true;
          active--;
          // Authentication or middleware may return before any root method runs.
          announce(trace, candidates[0], send);
          send({
            type: 'end',
            requestId: trace.id,
            status: res.writableFinished ? res.statusCode : 499,
            dropped: trace.dropped,
            durationMs,
          });
        });
      }
      res.once('finish', end);
      res.once('close', end);
      return context.run({ trace, callId: null }, dispatch);
    };
  }
  observeServer(HttpServer.prototype);
  observeServer(HttpsServer.prototype);
  const project = realpathSync(process.cwd());
  const source = path.join(project, 'src');
  if (framework === 'nestjs') {
    installNestSourceHook(project, entry, (message) => {
      if (process.connected) process.send({ type: 'warning', message });
    });
  } else installSourceHook(project, existsSync(source) ? source : project);
}

if (
  isMainThread &&
  process.send &&
  (process.env.SOLA_CALL_GRAPH_PROJECT || process.env.SOLA_CALL_GRAPH_ROUTE)
) {
  process.once('disconnect', () => process.exit(0));
  if (process.env.SOLA_CALL_GRAPH_PROJECT) {
    delete process.env.SOLA_CALL_GRAPH_PROJECT;
    const config = await new Promise((resolve, reject) => {
      process.once('message', (config) => {
        if (config?.type === 'configure' && Array.isArray(config.routes)) resolve(config);
        else reject(new Error('未收到项目探针的路由配置'));
      });
    });
    install(config.routes, false, config.limits, config.framework, config.entry);
  } else {
    const route = JSON.parse(process.env.SOLA_CALL_GRAPH_ROUTE);
    delete process.env.SOLA_CALL_GRAPH_ROUTE;
    install([route], true);
  }
}
