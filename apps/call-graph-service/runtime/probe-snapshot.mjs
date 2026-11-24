import { IncomingMessage, ServerResponse } from 'node:http';
import { types } from 'node:util';
import { Stream } from 'node:stream';

const sensitive =
  /password|passwd|pwd|secret|token|cookie|authorization|api[-_]?key|credential|private[-_]?key|session/i;
const MAX_DEPTH = 4,
  MAX_KEYS = 16,
  MAX_STRING = 240;
export const SNAPSHOT_VALUES_PER_CALL = 1000;
const exhausted = (budget) =>
  `[已截断：本次方法调用达到 ${budget.limit ?? SNAPSHOT_VALUES_PER_CALL} 个值]`;

const own = (value, field) => value && Object.getOwnPropertyDescriptor(value, field)?.value;

/** Koa 上下文含应用实例与连接池，仅取本次请求已解析的数据。 */
export function isKoaContext(value) {
  return (
    value &&
    typeof value === 'object' &&
    !types.isProxy(value) &&
    own(value, 'req') instanceof IncomingMessage &&
    own(value, 'res') instanceof ServerResponse &&
    !!own(value, 'request') &&
    !!own(value, 'response')
  );
}

export function koaBody(ctx) {
  return own(own(ctx, 'response'), '_body');
}

/** 在采集进程取有界快照，跳过访问器、代理和具有业务行为的对象。 */
export function snapshot(value, budget, field = '', depth = 0) {
  if (sensitive.test(field)) return '[已遮蔽]';
  if (budget.left <= 0) return exhausted(budget);
  budget.left--;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string')
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString() + 'n';
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'function') return '[函数]';
  if (typeof value === 'symbol') return '[Symbol]';
  if (types.isProxy(value)) return '[Proxy]';
  if (depth >= MAX_DEPTH) return '[达到深度上限]';
  if (isKoaContext(value)) {
    const request = own(value, 'request');
    return snapshot(
      { http: own(value, 'req'), params: own(value, 'params'), body: own(request, 'body') },
      budget,
      '',
      depth + 1,
    );
  }
  if (value instanceof IncomingMessage) {
    const raw = Object.getOwnPropertyDescriptor(value, 'url')?.value;
    const url = typeof raw === 'string' ? new URL(raw, 'http://localhost') : null;
    const summary = {
      type: 'HTTP 请求',
      method: Object.getOwnPropertyDescriptor(value, 'method')?.value,
      path: url?.pathname,
      query: Object.create(null),
    };
    if (url) {
      let count = 0;
      for (const [key, part] of url.searchParams) {
        if (++count > MAX_KEYS) break;
        const previous = summary.query[key];
        summary.query[key] = previous === undefined ? part : [].concat(previous, part);
      }
    }
    for (const key of ['params', 'body']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.hasOwn(descriptor, 'value')) summary[key] = descriptor.value;
    }
    return snapshot(summary, budget, '', depth);
  }
  if (value instanceof ServerResponse) return '[HTTP 响应]';
  if (value instanceof Stream) return '[Stream]';
  if (types.isArrayBufferView(value)) return '[二进制数据]';
  if (types.isNativeError(value)) {
    const message = Object.getOwnPropertyDescriptor(value, 'message')?.value;
    const kind = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value) ?? {}, 'name')?.value;
    return {
      name: typeof kind === 'string' ? kind : 'Error',
      message: typeof message === 'string' ? snapshot(message, budget) : '[异常]',
    };
  }
  if (types.isDate(value))
    return Date.prototype.toJSON.call(new Date(Date.prototype.getTime.call(value)));
  const array = Array.isArray(value);
  if (types.isMap(value) || types.isSet(value) || types.isPromise(value)) return '[集合或异步对象]';
  const copy = array ? [] : Object.create(null);
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (count++ >= MAX_KEYS || budget.left <= 0) {
      const marker = budget.left <= 0 ? exhausted(budget) : '[已截断]';
      if (array) copy.push(marker);
      else copy['…'] = marker;
      break;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const label = key.slice(0, MAX_STRING);
    const item = Object.hasOwn(descriptor, 'value')
      ? snapshot(descriptor.value, budget, key, depth + 1)
      : '[访问器]';
    if (array) copy.push(item);
    else copy[label] = item;
  }
  return copy;
}
