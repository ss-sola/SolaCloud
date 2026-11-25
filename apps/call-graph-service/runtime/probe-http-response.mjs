import { maxHeaderSize } from 'node:http';
import { ReadStream } from 'node:fs';
import { types } from 'node:util';
import zlib from 'node:zlib';
import { snapshot, SNAPSHOT_VALUES_PER_CALL } from './probe-snapshot.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const EMPTY = '[无响应体]';
const LARGE = '[响应正文超过 64 KiB，已省略]';
const BINARY = '[二进制响应，已省略正文]';
const STREAM = '[流式响应，已省略正文]';
const FILE = '[文件响应，已省略正文]';
const UNSUPPORTED_ENCODING = '[不支持的响应压缩格式，已省略正文]';
const INVALID_ENCODING = '[压缩响应无法解码，已省略正文]';
const EXPANDED_LARGE = '[响应解压后超过 64 KiB，已省略]';
const decoders = new Map([
  ['gzip', zlib.gunzipSync],
  ['x-gzip', zlib.gunzipSync],
  ['br', zlib.brotliDecompressSync],
  ['deflate', zlib.inflateSync],
  ['zstd', zlib.zstdDecompressSync],
]);
const INVALID_JSON = '[JSON 响应不完整，已省略正文]';
const MASKED = '[已遮蔽]';
const embeddedCredential =
  /(?:password|passwd|pwd|secret|token|authorization|cookie|credential|(?:api|private)[-_]?key|session)[\w.-]*["']?\s*[:=]|\b(?:bearer|basic)\s+[a-z\d+/_.=-]+|:\/\/[^\s/@]+:[^\s/@]+@/i;
const embeddedJson = /(?:^|[\s:=])[{[]\s*(?:"|\{|\[)|"[^"]{1,100}"\s*:/;

function safeText(text) {
  let decoded = text;
  if (text.includes('%')) {
    try {
      decoded = decodeURIComponent(text);
    } catch {
      /* Not a URL-encoded value. */
    }
  }
  if (embeddedCredential.test(text) || embeddedCredential.test(decoded)) return MASKED;
  if (embeddedJson.test(text) || embeddedJson.test(decoded)) return '[内嵌 JSON 文本，已省略]';
  return text;
}

export function protectHttpStrings(copy) {
  if (typeof copy === 'string') return safeText(copy);
  if (copy && typeof copy === 'object') {
    for (const key of Object.keys(copy)) {
      if (safeText(key) !== key) {
        delete copy[key];
        copy['[已遮蔽字段]'] = MASKED;
      } else copy[key] = protectHttpStrings(copy[key]);
    }
  }
  return copy;
}

/** Snapshot before looking inside strings so application accessors are never invoked. */
export function snapshotHttpValue(value, limit = SNAPSHOT_VALUES_PER_CALL, field = '') {
  const max = Number.isSafeInteger(limit) && limit >= 0 ? limit : SNAPSHOT_VALUES_PER_CALL;
  return protectHttpStrings(snapshot(value, { left: max || Infinity, limit: max }, field));
}

/** HTTP fields are flat wire values. Preserve each complete field within the
 * configured value count and Node's header byte limit, including repeated lines. */
export function snapshotHttpHeaders(headers, limit = SNAPSHOT_VALUES_PER_CALL) {
  const result = Object.create(null);
  if (!headers || typeof headers !== 'object' || types.isProxy(headers)) return result;
  const max = Number.isSafeInteger(limit) && limit >= 0 ? limit : SNAPSHOT_VALUES_PER_CALL;
  let remaining = max || Infinity;
  let bytes = 0;
  for (const name in headers) {
    const field = Object.getOwnPropertyDescriptor(headers, name);
    if (!field) continue;
    const raw = Object.hasOwn(field, 'value') ? field.value : '[访问器]';
    const multiple = !types.isProxy(raw) && Array.isArray(raw);
    const values = multiple ? raw : [raw];
    const key = safeText(name) === name ? name : '[已遮蔽字段]';
    // Apply the same name-based redaction as body snapshots, independently of their string limit.
    const masked = key !== name || snapshot('', { left: 1 }, name) === MASKED;
    for (let i = 0; i < values.length; i++) {
      const item = Object.getOwnPropertyDescriptor(values, i);
      const value = item?.value;
      const text =
        typeof value === 'string' || typeof value === 'number'
          ? String(value)
          : '[非标准 HTTP 头值]';
      // HTTP/1 header strings delivered by Node are Latin-1. Count ": " and CRLF on each line.
      bytes += name.length + text.length + 4;
      if (!remaining || bytes > maxHeaderSize) {
        result['…'] = !remaining
          ? '[已截断：HTTP 头达到 ' + max + ' 个值]'
          : '[已截断：HTTP 头达到 ' + maxHeaderSize + ' 字节]';
        return result;
      }
      remaining--;
      if (masked) result[key] = MASKED;
      else if (multiple) (result[key] ??= []).push(safeText(text));
      else result[key] = safeText(text);
    }
  }
  return result;
}

function sentHeaders(res) {
  // ServerResponse can send writeHead-only headers without storing them in getHeaders().
  // Its serialized header includes those overrides and implicit Date/Connection headers.
  const wire = Object.getOwnPropertyDescriptor(res, '_header')?.value;
  if (typeof wire !== 'string' || !wire) {
    try {
      return res.getHeaders();
    } catch {
      return Object.create(null);
    }
  }
  const result = Object.create(null);
  for (const line of wire.split('\r\n').slice(1)) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const name = line.slice(0, colon).toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (result[name] === undefined) result[name] = value;
    else if (Array.isArray(result[name])) result[name].push(value);
    else result[name] = [result[name], value];
  }
  return result;
}

function bodyMode(headers, piped, encoding) {
  if (/^attachment\b|\bfilename\*?\s*=/i.test(String(headers['content-disposition'] ?? '')))
    return FILE;
  const type = String(headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (/^(?:text\/event-stream|application\/(?:[a-z-]*ndjson|json-seq|stream\+json))$/.test(type))
    return STREAM;
  const json = type === 'application/json' || type.endsWith('+json');
  if (!json && type && !type.startsWith('text/')) return BINARY;
  if (encoding && !decoders.get(encoding)) return UNSUPPORTED_ENCODING;
  if (piped && !encoding) return STREAM;
  return json ? 'json' : 'text';
}

function decodeText(bytes, mode, headers, limit) {
  const charset =
    /charset\s*=\s*["']?([^;\s"']+)/i.exec(String(headers['content-type'] ?? ''))?.[1] || 'utf-8';
  let text;
  try {
    text = new TextDecoder(charset, { fatal: true }).decode(bytes);
  } catch {
    return mode === 'json' ? INVALID_JSON : BINARY;
  }
  if (mode === 'json' || /^\s*[[{]/.test(text)) {
    try {
      return snapshotHttpValue(JSON.parse(text), limit);
    } catch {
      return INVALID_JSON;
    }
  }
  for (const char of text) if (char < ' ' && !'\r\n\t'.includes(char)) return BINARY;
  return snapshotHttpValue(text, limit);
}

function decodeBody(bytes, mode, encoding, headers, limit) {
  if (!encoding) return decodeText(bytes, mode, headers, limit);
  let decoded;
  try {
    decoded = decoders.get(encoding)(bytes, { maxOutputLength: MAX_BODY_BYTES });
    return decodeText(decoded, mode, headers, limit);
  } catch (error) {
    return error.code === 'ERR_BUFFER_TOO_LARGE' ? EXPANDED_LARGE : INVALID_ENCODING;
  } finally {
    decoded?.fill(0);
  }
}

/** Observe only accepted writes. The original response owns its callbacks, errors and backpressure. */
export function observeHttpResponse(req, res, snapshotLimit = SNAPSHOT_VALUES_PER_CALL) {
  let buffer,
    length = 0,
    mode,
    contentEncoding,
    piped = false,
    omitted,
    result;
  function omit(reason) {
    omitted = reason;
    buffer?.fill(0, 0, length);
    buffer = undefined;
  }
  const noBody = () =>
    req.method === 'HEAD' || [204, 205, 304].includes(res.statusCode) || res.statusCode < 200;
  const pipeCleanups = new Set();
  function onPipe(source) {
    piped = true;
    mode = undefined;
    if (source instanceof ReadStream) return omit(FILE);
    // In fs.ReadStream -> compressor -> response the response sees the compressor.
    // Its unpipe event identifies the upstream file before the final snapshot.
    if (source.writable && typeof source.on === 'function') {
      const onUnpipe = (upstream) => {
        if (upstream instanceof ReadStream) omit(FILE);
      };
      const cleanup = () => {
        source.off('unpipe', onUnpipe);
        source.off('close', cleanup);
        pipeCleanups.delete(cleanup);
      };
      source.on('unpipe', onUnpipe);
      source.once('close', cleanup);
      pipeCleanups.add(cleanup);
    }
  }
  res.on('pipe', onPipe);
  function append(chunk, encoding) {
    if (omitted || !chunk || typeof chunk === 'function' || noBody()) return;
    if (!mode) {
      const headers = sentHeaders(res);
      const wireEncoding = String(headers['content-encoding'] ?? '')
        .trim()
        .toLowerCase();
      contentEncoding = wireEncoding === 'identity' ? '' : wireEncoding;
      mode = bodyMode(headers, piped, contentEncoding);
    }
    if (mode !== 'json' && mode !== 'text') return omit(mode);
    const string = typeof chunk === 'string';
    const codec = typeof encoding === 'string' ? encoding : 'utf8';
    const size = string ? Buffer.byteLength(chunk, codec) : chunk.byteLength;
    if (!size) return;
    if (size + length > MAX_BODY_BYTES) return omit(LARGE);
    if (!buffer || buffer.length < size + length) {
      const next = Buffer.allocUnsafe(
        Math.max(size + length, Math.min(MAX_BODY_BYTES, (buffer?.length || 512) * 2)),
      );
      buffer?.copy(next, 0, 0, length);
      buffer?.fill(0, 0, length);
      buffer = next;
    }
    if (string) length += buffer.write(chunk, length, size, codec);
    else {
      buffer.set(chunk, length);
      length += size;
    }
  }
  const restore = [];
  for (const name of ['write', 'end']) {
    const descriptor = Object.getOwnPropertyDescriptor(res, name);
    const original = res[name];
    function observed(...args) {
      const returned = Reflect.apply(original, this, args);
      if (this === res && !result) {
        try {
          append(args[0], args[1]);
        } catch {
          omit('[响应正文无法采集]');
        }
      }
      return returned;
    }
    res[name] = observed;
    restore.push(() => {
      if (res[name] === observed) {
        if (descriptor) Object.defineProperty(res, name, descriptor);
        else delete res[name];
      }
    });
  }
  return () => {
    if (result) return result;
    res.off('pipe', onPipe);
    for (const cleanup of pipeCleanups) cleanup();
    for (const reset of restore) reset();
    const headers = sentHeaders(res);
    const responseHeaders = snapshotHttpHeaders(headers, snapshotLimit);
    let responseBody = EMPTY;
    if (res.destroyed && !res.writableFinished) responseBody = '[响应中断，已省略正文]';
    else if (!noBody()) {
      if (omitted) responseBody = omitted;
      else if (length)
        responseBody = decodeBody(
          buffer.subarray(0, length),
          mode,
          contentEncoding,
          headers,
          snapshotLimit,
        );
    }
    buffer?.fill(0, 0, length);
    buffer = undefined;
    result = { responseHeaders, responseBody };
    return result;
  };
}
