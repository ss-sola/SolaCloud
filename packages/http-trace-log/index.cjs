const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');

const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const MAX_BYTES = 4096;
const MAX_DEPTH = 6;
const MAX_FIELDS = 80;
const MAX_STRING = 1024;
const protectedLoggers = new WeakSet();
const secretKey =
  /password|passwd|passphrase|pwd|token|secret|authorization|authentication|cookie|credential|^x?auth$|^x?authcode$|apikey|accesskey|privatekey|session(id|key|signature)?$|verificationcode|verifycode|captcha|otp$|signature|^sign$|^sig$|csrf|xsrf|idempotencykey|email|phone|mobile|idcard|bankaccount/i;
const secretValue =
  /\b(?:Bearer|Basic)\s+[^\s,;]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN [^-]*PRIVATE KEY-----|:\/\/[^\s/@:]*:[^\s/@]+@|(?:password|passwd|token|secret|api[_-]?key|signature|sig|code_verifier|code_challenge|sessionid|captcha)["']?\s*(?:=|:|%3d|%3a)/i;
const dataType = /^(?:multipart\/|application\/octet-stream\b|text\/event-stream\b)/i;
const jsonType = /^(?:application\/(?:[\w.-]+\+)?json)(?:;|$)/i;
const streamRoute = /\/(?:file\/upload(?:\/[^/?]+)?|chat\/send)\/?$/i;
const traceQueryRoute = /\/system\/trace-logs(?:\/detail)?\/?$/i;
const dictionaryItemRoute = /\/system\/dictionaries\/item\/?$/i;

function isSecretKey(key) {
  return typeof key === 'string' && secretKey.test(key.replace(/[^a-z0-9]/gi, ''));
}

function sanitize(value, state, depth = 0, name = '') {
  if (isSecretKey(name)) return REDACTED;
  if (typeof value === 'string') {
    if (
      secretValue.test(value) ||
      (/%(?:25|[0-9a-f]{2})/i.test(value) && secretValue.test(decodeForDetection(value)))
    ) {
      return REDACTED;
    }
    if (value.length > MAX_STRING) state.truncated = true;
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + TRUNCATED : value;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value !== 'object' || Buffer.isBuffer(value) || ArrayBuffer.isView(value))
    return undefined;
  if (depth === MAX_DEPTH) {
    state.truncated = true;
    return TRUNCATED;
  }
  const result = Array.isArray(value) ? [] : Object.create(null);
  // Dictionary records and validation errors identify sensitive values by a sibling field.
  const redactValue =
    (depth === 0 && state.redactRootValue) ||
    isSecretKey(Object.getOwnPropertyDescriptor(value, 'key')?.value) ||
    isSecretKey(Object.getOwnPropertyDescriptor(value, 'property')?.value);
  for (const key of Object.keys(value)) {
    if (++state.fields > MAX_FIELDS) {
      state.truncated = true;
      break;
    }
    if (key.length > MAX_STRING || secretValue.test(key)) {
      state.truncated = true;
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) continue;
    const safe =
      key === 'value' && redactValue ? REDACTED : sanitize(descriptor.value, state, depth + 1, key);
    if (safe === undefined) continue;
    state.bytes +=
      Buffer.byteLength(key) +
      (typeof safe === 'object' && safe !== null ? 2 : Buffer.byteLength(JSON.stringify(safe))) +
      4;
    if (state.bytes > MAX_BYTES) {
      state.truncated = true;
      break;
    }
    if (Array.isArray(result)) result.push(safe);
    else result[key] = safe;
  }
  return result;
}

function decodeForDetection(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function section(value, redactRootValue = false) {
  const state = { bytes: 0, fields: 0, truncated: false, redactRootValue };
  try {
    const safe = sanitize(value, state);
    if (safe === undefined) return { state: 'omitted' };
    if (Buffer.byteLength(JSON.stringify(safe)) > MAX_BYTES) return { state: 'truncated' };
    return { state: state.truncated ? 'truncated' : 'captured', value: safe };
  } catch {
    return { state: 'omitted' };
  }
}

class HttpTraceLog {
  static installSdkLogPolicy(logger) {
    if (protectedLoggers.has(logger)) return;
    protectedLoggers.add(logger);
    // The SDK writes its legacy access log directly through AppLogger, including raw URLs.
    const { debug, error, warn } = logger.prototype;
    logger.prototype.debug = function (message, context) {
      if (context !== 'HttpAccess') debug.call(this, message, context);
    };
    logger.prototype.warn = function (message, context) {
      warn.call(this, context === 'GlobalExceptionFilter' ? '接口未找到' : message, context);
    };
    logger.prototype.error = function (message, trace, context) {
      // Nest can pass the context as the second argument when there is no separate stack.
      if (context !== 'GlobalExceptionFilter' && trace !== 'GlobalExceptionFilter') {
        error.call(this, message, trace, context);
        return;
      }
      const [summary, ...stack] = typeof message === 'string' ? message.split('\n', 48) : [];
      let metadata = {};
      try {
        const parsed = JSON.parse(summary);
        metadata = { method: parsed.method, status: parsed.status };
      } catch {
        // Unexpected SDK formats must not log arbitrary exception text.
      }
      const frames = stack.filter((line) => /^\s+at\s/.test(line) && !secretValue.test(line));
      error.call(
        this,
        JSON.stringify(metadata) + '\n' + frames.join('\n'),
        undefined,
        'GlobalExceptionFilter',
      );
    };
  }

  static parentSpanId(request) {
    const header = request.headers?.traceparent;
    return typeof header === 'string'
      ? /^00-(?!0{32})[a-f0-9]{32}-((?!0{16})[a-f0-9]{16})-[a-f0-9]{2}$/.exec(header)?.[1]
      : undefined;
  }

  static headers(headers) {
    const values = Object.create(null);
    for (const [name, value] of Object.entries(headers)) {
      // Redirects and referrers can contain secrets in URLs with arbitrary query keys.
      values[name] = /^(location|referer|referrer|link|refresh|tracestate|baggage)$/i.test(name)
        ? REDACTED
        : value;
    }
    return section(values);
  }

  static observe(logger) {
    return (request, response, next) => {
      const startedAtMs = Date.now();
      const startedAt = performance.now();
      const path = (request.originalUrl ?? '').split('?', 1)[0];
      const skipBody =
        streamRoute.test(path) || dataType.test(request.headers?.['content-type'] ?? '');
      const skipResponse = skipBody || traceQueryRoute.test(path);
      let responseBody;
      if (!skipResponse && typeof response.json === 'function') {
        const json = response.json;
        response.json = function (body) {
          if (!this.headersSent && !dataType.test(String(this.getHeader('content-type') ?? ''))) {
            // A server error message may echo arbitrary runtime input. Keep only its code.
            responseBody =
              this.statusCode >= 500 && typeof body === 'object' && body !== null
                ? section({
                    code: typeof body.code === 'number' ? body.code : this.statusCode,
                    message: REDACTED,
                  })
                : section(body);
          }
          return json.call(this, body);
        };
      }
      response.once(
        'finish',
        AsyncLocalStorage.bind(() => {
          const route = request.route?.path;
          if (typeof route !== 'string') return;
          const status = response.statusCode;
          const responseType = String(response.getHeader?.('content-type') ?? '');
          const streamed = skipBody || dataType.test(responseType);
          const noBody =
            status === 204 || status === 205 || status === 304 || request.method === 'HEAD';
          logger.log({
            method: request.method,
            path: route,
            status,
            startedAtMs,
            durationMs: Math.round(performance.now() - startedAt),
            parentSpanId: HttpTraceLog.parentSpanId(request),
            httpDetails: {
              requestHeaders: HttpTraceLog.headers(request.headers ?? {}),
              params: section(request.params),
              query: section(request.query),
              requestBody: streamed
                ? { state: 'skipped' }
                : jsonType.test(request.headers?.['content-type'] ?? '')
                  ? section(
                      request.body,
                      dictionaryItemRoute.test(path) && isSecretKey(request.query?.key),
                    )
                  : { state: request.body === undefined ? 'empty' : 'omitted' },
              responseHeaders: HttpTraceLog.headers(response.getHeaders?.() ?? {}),
              responseBody:
                streamed || skipResponse
                  ? { state: 'skipped' }
                  : noBody
                    ? { state: 'empty' }
                    : (jsonType.test(responseType) && responseBody) || { state: 'omitted' },
            },
          });
        }),
      );
      next();
    };
  }
}

module.exports = { HttpTraceLog };
