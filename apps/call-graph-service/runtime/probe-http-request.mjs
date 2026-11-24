import { types } from 'node:util';
import { isKoaContext } from './probe-snapshot.mjs';
import {
  protectHttpStrings,
  snapshotHttpHeaders,
  snapshotHttpValue,
} from './probe-http-response.mjs';

function data(object, key) {
  if (!object || typeof object !== 'object' || types.isProxy(object)) return;
  return Object.getOwnPropertyDescriptor(object, key)?.value;
}

// Fold repeated query keys into arrays before applying the normal snapshot limits.
function queryValues(url) {
  const result = Object.create(null);
  const mark = typeof url === 'string' ? url.indexOf('?') : -1;
  if (mark < 0) return result;
  const search = new URLSearchParams(url.slice(mark + 1));
  let keys = 0;
  for (const [rawKey, value] of search) {
    const key = protectHttpStrings(rawKey);
    if (!Object.hasOwn(result, key)) {
      if (++keys > 16) {
        result['…'] = '[已截断]';
        break;
      }
      result[key] = value;
    } else if (Array.isArray(result[key])) {
      // A seventeenth item lets the snapshot mark that this array was truncated.
      if (result[key].length < 17) result[key].push(value);
    } else result[key] = [result[key], value];
  }
  return result;
}

function safe(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function requestPath(pathname, template) {
  // A masked path parameter must not reappear verbatim in the request title.
  for (const [, name] of template.matchAll(/[:*]"?([\w$-]+)/g))
    if (snapshotHttpValue('x', 1, name) === '[已遮蔽]') return template;
  return protectHttpStrings(pathname) === pathname ? pathname : template;
}

export function observeHttpRequest(req, limit) {
  const headers = safe(() => req.headers, {});
  const requestHeaders = safe(() => snapshotHttpHeaders(headers, limit), {});
  const type = data(headers, 'content-type');
  const json =
    typeof type === 'string' && /^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(type);
  const parameters = {
    query: safe(() => snapshotHttpValue(queryValues(data(req, 'url')), limit), {}),
  };
  let ctx;
  function rememberContext(candidate) {
    if (!ctx && safe(() => isKoaContext(candidate) && data(candidate, 'req') === req, false))
      ctx = candidate;
  }
  function bodyText(value) {
    if (!json) return '[原始文本请求体，已省略]';
    if (/^\s*[{[]/.test(value)) return '[内嵌 JSON 文本，已省略]';
  }
  function readParameters() {
    const koaRequest = data(ctx, 'request');
    if (!Object.hasOwn(parameters, 'path')) {
      const value = data(ctx, 'params') ?? data(koaRequest, 'params') ?? data(req, 'params');
      if (value !== undefined)
        parameters.path = safe(() => snapshotHttpValue(value, limit), '[无法快照]');
    }
    if (!Object.hasOwn(parameters, 'body')) {
      // Do not consult rawBody or attach a data listener: body parsing belongs to the target.
      const koaBody = data(koaRequest, 'body');
      const value = koaBody === undefined ? data(req, 'body') : koaBody;
      if (value !== undefined) {
        const marker = typeof value === 'string' ? bodyText(value) : undefined;
        parameters.body = marker ?? safe(() => snapshotHttpValue(value, limit), '[无法快照]');
      }
    }
    // Packets may be queued until the next event-loop turn. Earlier events keep their own fields.
    return { ...parameters };
  }
  function protectArgument(value, copy, displayPath) {
    if ((value !== req && (!ctx || value !== ctx)) || !copy || typeof copy !== 'object')
      return copy;
    const http = value === req ? copy : copy.http;
    if (http && typeof http === 'object') {
      if (displayPath && Object.hasOwn(http, 'path')) http.path = displayPath;
      const raw = data(req, 'body');
      if (typeof raw === 'string' && typeof http.body === 'string')
        http.body = bodyText(raw) ?? http.body;
    }
    if (value === ctx) {
      const raw = data(data(ctx, 'request'), 'body');
      if (typeof raw === 'string' && typeof copy.body === 'string')
        copy.body = bodyText(raw) ?? copy.body;
    }
    return protectHttpStrings(copy);
  }
  return {
    requestHeaders,
    initial: { ...parameters },
    rememberContext,
    readParameters,
    protectArgument,
  };
}
