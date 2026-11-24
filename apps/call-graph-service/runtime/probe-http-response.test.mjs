import assert from 'node:assert/strict';
import { createReadStream, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer, maxHeaderSize, request, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import zlib, { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import {
  observeHttpResponse,
  snapshotHttpHeaders,
  snapshotHttpValue,
} from './probe-http-response.mjs';

async function exchange(handler, options = {}) {
  const { promise: captured, resolve, reject } = Promise.withResolvers();
  const server = createServer((req, res) => {
    const finish = observeHttpResponse(req, res, options.limit);
    res.once('finish', () =>
      setImmediate(() => {
        try {
          resolve(finish());
        } catch (error) {
          reject(error);
        }
      }),
    );
    handler(req, res);
  });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const client = request({
      host: '127.0.0.1',
      port: server.address().port,
      method: options.method,
      headers: options.headers,
      agent: false,
    });
    const response = once(client, 'response');
    client.end();
    const [res] = await response;
    const raw = [];
    for await (const chunk of res) raw.push(chunk);
    return {
      data: await captured,
      bytes: Buffer.concat(raw),
      status: res.statusCode,
      headers: res.headers,
    };
  } finally {
    await new Promise((done) => server.close(done));
  }
}

test('captures the final framework JSON and wire headers, including errors and writeHead overrides', async () => {
  const envelope = {
    code: 422,
    data: {
      name: '中文🍊',
      accessToken: 'sensitive-secret',
      nested: { password: 'sensitive-secret' },
    },
    problem: 'validation failed',
    link: '/continue?%74oken=sensitive-secret',
  };
  const raw = Buffer.from(JSON.stringify(envelope));
  const calls = [];
  const { data, status, headers, bytes } = await exchange((req, res) => {
    res.setHeader('X-Phase', 'early');
    res.writeHead(422, 'Validation error', {
      'Content-Type': 'application/problem+json; charset=utf-8',
      'X-Phase': 'wire',
      'Set-Cookie': ['id=sensitive-secret', 'token=sensitive-secret'],
    });
    const split = raw.indexOf(Buffer.from('🍊')) + 2;
    assert.equal(
      res.write(raw.subarray(0, split), () => calls.push('write')),
      true,
    );
    assert.equal(
      res.end(raw.subarray(split), () => calls.push('end')),
      res,
    );
  });
  assert.equal(status, 422);
  assert.deepEqual(calls, ['write', 'end']);
  assert.deepEqual(bytes, raw);
  assert.equal(headers['x-phase'], 'wire');
  assert.equal(data.responseHeaders['x-phase'], 'wire');
  assert.equal(data.responseHeaders['set-cookie'], '[已遮蔽]');
  assert.ok(data.responseHeaders.date);
  assert.equal(data.responseBody.data.name, '中文🍊');
  assert.equal(data.responseBody.code, 422);
  assert.equal(data.responseBody.problem, 'validation failed');
  assert.equal(data.responseBody.link, '[已遮蔽]');
  assert.ok(!JSON.stringify(data).includes('sensitive-secret'));
});

test('distinguishes empty, JSON null, plain text, and incomplete or oversized JSON', async () => {
  const cases = [
    [{ method: 'HEAD' }, 200, 'application/json', '{"ok":true}', '[无响应体]'],
    [{}, 204, 'application/json', undefined, '[无响应体]'],
    [{}, 304, 'text/plain', undefined, '[无响应体]'],
    [{}, 200, 'application/json', 'null', null],
    [{}, 200, 'text/plain; charset=utf-8', '普通文本', '普通文本'],
    [{}, 500, 'text/plain', 'Authorization: Bearer hidden', '[已遮蔽]'],
    [{}, 200, 'text/plain', '{"password":"hidden"', '[JSON 响应不完整，已省略正文]'],
    [
      {},
      200,
      'application/json',
      '{"token":"hidden"' + ' '.repeat(70000),
      '[响应正文超过 64 KiB，已省略]',
    ],
  ];
  for (const [options, status, type, body, expected] of cases) {
    const { data } = await exchange((req, res) => {
      res.writeHead(status, ['Content-Type', type, 'X-Direct', 'direct-head']);
      if (body === undefined) res.end(() => {});
      else res.end(body, 'utf8');
    }, options);
    assert.equal(data.responseHeaders['x-direct'], 'direct-head');
    assert.equal(data.responseBody, expected);
    assert.ok(!JSON.stringify(data).includes('hidden'));
  }
});

test('leaves binary and compressed bytes, streaming and backpressure intact', async () => {
  const compressed = gzipSync('{"token":"hidden"}');
  const gzip = await exchange((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
    res.end(compressed);
  });
  assert.deepEqual(gzip.bytes, compressed);
  assert.equal(gzip.data.responseBody.token, '[已遮蔽]');
  const binary = await exchange((req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(Buffer.from([0, 255]));
  });
  assert.deepEqual(binary.bytes, Buffer.from([0, 255]));
  assert.equal(binary.data.responseBody, '[二进制响应，已省略正文]');
  const streamed = await exchange((req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    Readable.from(['stream-', 'contents']).pipe(res);
  });
  assert.equal(streamed.bytes.toString(), 'stream-contents');
  assert.equal(streamed.data.responseBody, '[流式响应，已省略正文]');
  const large = Buffer.alloc(2 * 1024 * 1024, 0x61);
  let callback = false;
  const backpressure = await exchange((req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    const accepted = res.write(large, () => {
      callback = true;
    });
    assert.equal(accepted, false);
    res.once('drain', () => res.end());
  });
  assert.equal(callback, true);
  assert.deepEqual(backpressure.bytes, large);
  assert.equal(backpressure.data.responseBody, '[响应正文超过 64 KiB，已省略]');
});

test('header and field snapshots mask credentials nested inside ordinary HTTP strings and obey value limits', () => {
  const headers = snapshotHttpHeaders({
    cookie: 'test-sensitive',
    authorization: 'test-sensitive',
    referer: 'https://site/?access%5Ftoken=test-sensitive',
    note: '{"secret":"test-sensitive"}',
    'x-app': 'normal',
  });
  assert.equal(headers['x-app'], 'normal');
  assert.ok(!JSON.stringify(headers).includes('test-sensitive'));
  const value = snapshotHttpValue(
    {
      link: 'https://user:test-sensitive@site/',
      child: [{ note: '{"test":2}' }],
      array: [1, 2, 3],
    },
    0,
  );
  assert.equal(value.link, '[已遮蔽]');
  assert.deepEqual(value.array, [1, 2, 3]);
  assert.equal(value.child[0].note, '[内嵌 JSON 文本，已省略]');
  assert.match(JSON.stringify(snapshotHttpValue({ one: 1, two: 2 }, 2)), /已截断/);
});

test('never returns a fragment for an aborted response and preserves native write errors', () => {
  const req = { method: 'GET' };
  const res = new ServerResponse(req);
  const finish = observeHttpResponse(req, res);
  res.setHeader('Content-Type', 'application/json');
  assert.throws(() => res.write({ oops: true }), { code: 'ERR_INVALID_ARG_TYPE' });
  res.write('{"token":"aborted-secret');
  res.destroy();
  const result = finish();
  assert.equal(result.responseBody, '[响应中断，已省略正文]');
  assert.ok(!JSON.stringify(result).includes('aborted-secret'));
  assert.equal(finish(), result);
  assert.equal(res.write, ServerResponse.prototype.write);
  assert.equal(res.end, ServerResponse.prototype.end);
});

test('preserves the twentieth request and response headers, long values and repeated wire fields', async () => {
  const fields = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => ['x-field-' + (i + 1), 'value-' + (i + 1)]),
  );
  const repeated = Array.from({ length: 20 }, (_, i) => 'part-' + (i + 1));
  const long = 'a'.repeat(360);
  let requestHeaders;
  const { data } = await exchange(
    (req, res) => {
      requestHeaders = snapshotHttpHeaders(req.headers);
      res.writeHead(200, {
        ...fields,
        'X-Long': long,
        'X-Repeated': repeated,
        'Set-Cookie': 'test-marker',
      });
      res.end();
    },
    { headers: { ...fields, 'X-Long': long, Authorization: 'Bearer test-marker' } },
  );
  for (const captured of [requestHeaders, data.responseHeaders]) {
    assert.equal(captured['x-field-20'], 'value-20');
    assert.equal(captured['x-long'], long);
    assert.equal(captured['…'], undefined);
    assert.ok(!JSON.stringify(captured).includes('test-marker'));
  }
  assert.equal(requestHeaders.authorization, '[已遮蔽]');
  assert.equal(data.responseHeaders['set-cookie'], '[已遮蔽]');
  assert.deepEqual(data.responseHeaders['x-repeated'], repeated);
});

test('limits headers by configured values and complete wire fields within the native HTTP byte limit', () => {
  const valueLimited = snapshotHttpHeaders(
    { 'x-multi': ['one', 'two', 'three'], 'x-extra': 'left out' },
    2,
  );
  assert.deepEqual(valueLimited['x-multi'], ['one', 'two']);
  assert.equal(valueLimited['x-extra'], undefined);
  assert.match(valueLimited['…'], /2 个值/);
  const sizeLimited = snapshotHttpHeaders(
    { 'x-first': 'complete', 'x-large': 'x'.repeat(maxHeaderSize) },
    0,
  );
  assert.equal(sizeLimited['x-first'], 'complete');
  assert.equal(sizeLimited['x-large'], undefined);
  assert.match(sizeLimited['…'], /字节/);
});

test('reads the final JSON or text written through ordinary compression middleware pipes', async () => {
  const encodings = [
    ['gzip', zlib.createGzip, zlib.gunzipSync],
    ['br', zlib.createBrotliCompress, zlib.brotliDecompressSync],
    ['deflate', zlib.createDeflate, zlib.inflateSync],
    ['zstd', zlib.createZstdCompress, zlib.zstdDecompressSync],
  ];
  for (const [encoding, compress, decompress] of encodings) {
    if (!compress || !decompress) continue;
    const body = JSON.stringify({ status: 'ok', data: { name: '课程', token: 'private-value' } });
    const { data, bytes } = await exchange((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Encoding', encoding);
      const stream = compress();
      stream.end(body);
      stream.pipe(res);
    });
    assert.equal(data.responseHeaders['content-encoding'], encoding);
    assert.equal(decompress(bytes).toString(), body);
    assert.equal(data.responseBody.data.name, '课程');
    assert.equal(data.responseBody.data.token, '[已遮蔽]');
    assert.ok(!JSON.stringify(data).includes('private-value'));
  }
  const text = await exchange((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' });
    Readable.from([gzipSync('hello world')]).pipe(res);
  });
  assert.equal(text.data.responseBody, 'hello world');
});

test('skips invalid, oversized, file and streaming compressed responses without leaking partial data', async () => {
  const input = randomBytes(66 * 1024);
  const cases = [
    [
      'application/json',
      'gzip',
      Buffer.from('{"token":"raw-secret"}'),
      {},
      '[压缩响应无法解码，已省略正文]',
    ],
    ['application/json', 'gzip', gzipSync(input), {}, '[响应正文超过 64 KiB，已省略]'],
    [
      'application/json',
      'gzip',
      gzipSync('x'.repeat(65537)),
      {},
      '[响应解压后超过 64 KiB，已省略]',
    ],
    ['text/event-stream', 'gzip', gzipSync('data: raw-secret\n\n'), {}, '[流式响应，已省略正文]'],
    [
      'application/x-ndjson',
      'br',
      zlib.brotliCompressSync('{"token":"raw-secret"}\n'),
      {},
      '[流式响应，已省略正文]',
    ],
    [
      'application/json',
      'gzip',
      gzipSync('raw-secret'),
      { 'Content-Disposition': 'attachment; filename="report.json"' },
      '[文件响应，已省略正文]',
    ],
    ['application/octet-stream', 'gzip', gzipSync('raw-secret'), {}, '[二进制响应，已省略正文]'],
    [
      'application/json',
      'unknown',
      Buffer.from('raw-secret'),
      {},
      '[不支持的响应压缩格式，已省略正文]',
    ],
  ];
  for (const [mime, encoding, body, extra, expected] of cases) {
    const { data, bytes } = await exchange((req, res) => {
      res.writeHead(200, { 'Content-Type': mime, 'Content-Encoding': encoding, ...extra });
      Readable.from([body]).pipe(res);
    });
    assert.deepEqual(bytes, body);
    assert.equal(data.responseBody, expected);
    assert.ok(!JSON.stringify(data).includes('raw-secret'));
  }
  // A gzip transform can hide the original file stream from the HTTP response's pipe event.
  const file = new URL('./probe-http-response.test.mjs', import.meta.url);
  const realFile = await exchange((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' });
    createReadStream(file).pipe(zlib.createGzip()).pipe(res);
  });
  assert.equal(realFile.data.responseBody, '[文件响应，已省略正文]');
  assert.deepEqual(zlib.gunzipSync(realFile.bytes), readFileSync(file));
});
