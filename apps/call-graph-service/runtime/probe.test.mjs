import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { observeHttpRequest } from './probe-http-request.mjs';

const source = `
import http from 'node:http';
import { once } from 'node:events';

class Arithmetic {
  base = 4;
  async compute(n: number, password: string) {
    const sum = (x: number) => this.base + x;
    if (n < 0) throw new Error('negative');
    await once(process, 'message');
    return sum(n);
  }
}
const service = new Arithmetic();
async function handler(ctx) {
  const value = await service.compute(ctx.params.id, 'private-value');
  ctx.response._body = { value, token: 'private-value' };
}
http.createServer(async (req, res) => {
  const id = Number(req.url.split('?')[0].split('/')[2]);
  const ctx = { req, res, request: { body: { apiKey: 'private-value' } }, response: {}, params: { id } };
  try { await handler(ctx); res.end(JSON.stringify(ctx.response._body)); }
  catch { res.writeHead(400).end('failure'); }
}).listen(0, '127.0.0.1');
`;

async function startFixture(t, source, projectRoutes, limits) {
  const project = await mkdtemp(path.join(tmpdir(), 'sola-graph-'));
  const entry = path.join(project, 'src', 'index.mts');
  await mkdir(path.dirname(entry));
  await writeFile(entry, source);
  const route = {
    id: 'sample',
    method: 'GET',
    path: '/items/:id',
    roots: ['src/index.mts:' + source.indexOf('async function handler')],
  };
  const child = fork(entry, {
    cwd: project,
    execArgv: ['--import', new URL('./probe.mjs', import.meta.url).href],
    env: {
      ...process.env,
      ...(projectRoutes
        ? { SOLA_CALL_GRAPH_PROJECT: '1' }
        : { SOLA_CALL_GRAPH_ROUTE: JSON.stringify(route) }),
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const events = [];
  child.on('message', (event) => {
    if (event.type === 'events') events.push(...event.events);
    else events.push(event);
  });
  if (projectRoutes) child.send({ type: 'configure', routes: projectRoutes, limits });
  async function until(predicate) {
    while (!predicate()) await once(child, 'message', { signal: AbortSignal.timeout(5000) });
  }
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    await rm(project, { recursive: true, force: true });
  });
  await until(() => events.some((e) => e.type === 'listening'));
  const address = 'http://127.0.0.1:' + events.find((e) => e.type === 'listening').port;
  return { address, child, events, route, until };
}

test('HTTP 参数采集不会执行请求对象上的访问器，二进制只显示类型', () => {
  let invoked = 0;
  const req = { url: '/demo', headers: {}, body: Buffer.from('private-bytes') };
  Object.defineProperty(req, 'params', {
    get() {
      invoked++;
      throw new Error('业务访问器');
    },
  });
  const observed = observeHttpRequest(req, 1000);
  const parameters = observed.readParameters();
  assert.deepEqual(Object.keys(parameters.query), []);
  assert.equal(Object.hasOwn(parameters, 'path'), false);
  assert.equal(parameters.body, '[二进制数据]');
  assert.equal(invoked, 0);
});

test('同一处理器被多个候选路由复用时按 Koa 实际匹配的模板归档', { timeout: 15000 }, async (t) => {
  const fixture = `
    import http from 'node:http';
    async function handler(ctx) { return ctx._matchedRoute; }
    http.createServer(async (req,res) => {
      if (req.headers.reject) { res.writeHead(401).end(); return; }
      const ctx = { req, res, request: {}, response: {}, _matchedRoute: req.headers.template };
      res.end(await handler(ctx));
    }).listen(0, '127.0.0.1');
  `;
  const roots = ['src/index.mts:' + fixture.indexOf('async function handler')];
  const routes = ['/items/special', '/items/:id'].map((path) => ({
    id: 'GET ' + path,
    method: 'GET',
    path,
    roots,
  }));
  const { address, events, until } = await startFixture(t, fixture, routes);
  // Both calls have exactly the same method, URL and root handler ID.
  for (const route of routes) {
    const response = await fetch(address + '/items/special', { headers: { template: route.path } });
    assert.equal(await response.text(), route.path);
  }
  assert.equal((await fetch(address + '/items/abc', { headers: { reject: '1' } })).status, 401);
  await until(() => events.filter((e) => e.type === 'end').length === 3);
  const requests = events.filter((e) => e.type === 'request');
  assert.deepEqual(
    requests.map((e) => e.routeId),
    [routes[0].id, routes[1].id, routes[1].id],
  );
  for (const request of requests.slice(0, 2)) {
    const entered = events.filter((e) => e.requestId === request.requestId && e.type === 'enter');
    assert.equal(entered.length, 1);
    assert.equal(entered[0].routeId, request.routeId);
  }
  assert.ok(!events.some((e) => e.requestId === requests[2].requestId && e.type === 'enter'));
});

test(
  '采集入口参数的时序和保密性：中间件、早退、重复查询和有限额度',
  { timeout: 15000 },
  async (t) => {
    const fixture = `
    import http from 'node:http';
    function first(ctx){ return true; }
    function second(ctx){ return true; }
    function noteMiddleware(ctx){}
    http.createServer(async(req,res)=>{
      const ctx={req,res,request:{},response:{}};
      const parts=[];
      for await(const chunk of req)parts.push(chunk);
      const text=Buffer.concat(parts).toString();
      const marker=req.headers['x-fixture'];
      noteMiddleware(ctx);
      // Simulate a completed parser, including native req.body as used by Express.
      const parsed=marker==='raw'?text:JSON.parse(text);
      if(marker==='early'){
        req.params={id:'early'};
        req.body=parsed;
        return res.writeHead(401).end();
      }
      ctx.params={token:'private-path'};
      ctx.request.body=parsed;
      first(ctx);
      // Middleware can change request objects after the actual input was captured.
      ctx.request.body='changed';ctx.params={id:'changed'};second(ctx);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({length:text.length}));
    }).listen(0,'127.0.0.1');`;
    const routes = [
      {
        id: 'POST /demo/:token',
        method: 'POST',
        path: '/demo/:token',
        roots: ['first', 'second'].map(
          (n) => 'src/index.mts:' + fixture.indexOf('function ' + n + '('),
        ),
      },
    ];
    const { address, events, until } = await startFixture(t, fixture, routes, {
      maxCallsPerRequest: 1,
    });
    const cases = [
      { text: '{"password":"private-json","ok":0}', expected: { password: '[已遮蔽]', ok: 0 } },
      { text: '"正常字符串"', expected: '正常字符串' },
      { text: 'false', expected: false },
      { text: 'null', expected: null },
      { text: '0', expected: 0 },
      {
        text: '{"password":"private-raw"}',
        mode: 'raw',
        type: 'text/plain',
        expected: '[原始文本请求体，已省略]',
      },
      { text: '{"key":"private-raw"}', mode: 'raw', expected: '[内嵌 JSON 文本，已省略]' },
      { text: '{"value":7}', mode: 'early', expected: { value: 7 } },
    ];
    for (const [i, item] of cases.entries()) {
      const response = await fetch(address + '/demo/private-path?tag=a&tag=b&token=private-query', {
        method: 'POST',
        headers: {
          'content-type': item.type ?? 'application/json',
          'x-fixture': item.mode ?? 'parsed',
          authorization: 'Bearer private-header',
          referer: 'http://example.test/?token=private-referer',
        },
        body: item.text,
      });
      const early = item.mode === 'early';
      assert.equal(response.status, early ? 401 : 200);
      if (!early) assert.equal((await response.json()).length, item.text.length);
      await until(() => events.filter((e) => e.type === 'end').length === i + 1);
      const start = events.filter((e) => e.type === 'request').at(-1);
      const trace = events.filter((e) => e.requestId === start.requestId);
      assert.equal(start.path, '/demo/:token');
      assert.equal(start.requestHeaders.authorization, '[已遮蔽]');
      assert.deepEqual(start.parameters, { query: { tag: ['a', 'b'], token: '[已遮蔽]' } });
      const updates = trace.filter((e) => e.type === 'requestParams');
      assert.equal(updates.length, early ? 0 : 1);
      const params = {
        ...start.parameters,
        path: early ? { id: 'early' } : { token: '[已遮蔽]' },
        body: item.expected,
      };
      if (!early) {
        assert.equal(trace[1].type, 'requestParams');
        assert.equal(trace[2].type, 'enter');
        assert.deepEqual(updates[0].parameters, params);
      }
      assert.deepEqual(trace.at(-1).parameters, params);
      assert.equal(trace.at(-1).dropped, early ? 0 : 1);
      assert.doesNotMatch(JSON.stringify(trace), /private-(?:query|json|header|raw|referer|path)/);
    }
  },
);

test('追踪选定参数路由的进入、实际返回或异常，并隔离并发请求', { timeout: 15000 }, async (t) => {
  const { address, child, events, route, until } = await startFixture(t, source);
  const outside = await fetch(address + '/other/-2');
  assert.equal(outside.status, 400);
  const first = fetch(address + '/items/3/?token=private-value');
  const second = fetch(address + '/items/6', {
    method: 'POST',
    headers: { 'x-http-method-override': 'GET' },
  });
  await until(
    () =>
      events.filter((e) => e.type === 'enter' && e.node.name === 'Arithmetic.compute').length === 2,
  );
  assert.equal(events.filter((e) => e.type === 'leave').length, 0);
  child.send('finish');
  assert.equal((await (await first).json()).value, 7);
  assert.equal((await (await second).json()).value, 10);
  assert.equal((await fetch(address + '/items/-1')).status, 400);
  await until(() => events.filter((e) => e.type === 'end').length === 3);
  assert.doesNotMatch(JSON.stringify(events), /private-value/);
  assert.equal(events.filter((e) => e.type === 'request').length, 3);
  for (const request of events.filter((e) => e.type === 'request')) {
    const span = events.filter((e) => e.requestId === request.requestId);
    const enters = span.filter((e) => e.type === 'enter');
    assert.equal(enters[0].node.id, route.roots[0]);
    assert.equal(enters[0].parentId, null);
    assert.equal(enters[1].parentId, enters[0].callId);
    assert.equal(enters[1].args[1].value, '[已遮蔽]');
    const result = span.find((e) => e.type === 'leave' && e.callId === enters[0].callId);
    assert.ok(result.durationMs >= 0);
    assert.equal(span.at(-1).type, 'end');
    if (request.path === '/items/-1') {
      assert.equal(result.state, 'error');
      assert.equal(result.result.message, 'negative');
    } else {
      assert.equal(result.state, 'ok');
      assert.equal(result.result.responseBody.token, '[已遮蔽]');
      assert.equal(enters[2].node.name, 'sum');
      assert.equal(enters[2].parentId, enters[1].callId);
    }
  }
});

test(
  '有限采集按请求独立计算，包含被省略根方法的所有子调用并排除处理链外调用',
  { timeout: 15000 },
  async (t) => {
    const fixture = `
      import http from 'node:http';
      import { once } from 'node:events';
      function leaf(n) { return n + 1; }
      function middle(a, b) { return leaf(a + b); }
      async function handler(n) {
        await once(process, 'message');
        return middle(n, 1);
      }
      async function secondRoot(n) {
        await Promise.resolve();
        return middle(n, 2);
      }
      function outside() { return leaf(0); }
      http.createServer(async (req, res) => {
        outside();
        const value = await handler(Number(req.url.slice(-1)));
        outside();
        const result = await secondRoot(value);
        outside();
        res.end(String(result));
      }).listen(0, '127.0.0.1');
    `;
    const roots = ['handler', 'secondRoot'].map(
      (name) => 'src/index.mts:' + fixture.indexOf('async function ' + name),
    );
    const routes = [{ id: 'items', method: 'GET', path: '/items/:id', roots }];
    const { address, child, events, until } = await startFixture(t, fixture, routes, {
      maxCallsPerRequest: 2,
      maxSnapshotValuesPerCall: 2,
    });
    const responses = Promise.all(
      [1, 2].map(async (n) => (await fetch(address + '/items/' + n)).text()),
    );
    await until(
      () => events.filter((e) => e.type === 'enter' && e.node.name === 'handler').length === 2,
    );
    child.send('continue');
    assert.deepEqual(await responses, ['6', '7']);
    await until(() => events.filter((e) => e.type === 'end').length === 2);
    const requests = events.filter((e) => e.type === 'request');
    assert.equal(requests.length, 2);
    for (const request of requests) {
      const span = events.filter((e) => e.requestId === request.requestId);
      const enters = span.filter((e) => e.type === 'enter');
      const leaves = span.filter((e) => e.type === 'leave');
      assert.deepEqual(
        enters.map((e) => e.node.name),
        ['handler', 'middle'],
      );
      assert.deepEqual(
        leaves.map((e) => e.callId),
        [enters[1].callId, enters[0].callId],
      );
      assert.equal(leaves[0].result, '[已截断：本次方法调用达到 2 个值]');
      assert.equal(leaves[1].result, Number(request.path.slice(-1)) + 2);
      assert.equal(span.at(-1).status, 200);
      assert.equal(span.at(-1).dropped, 4); // leaf, secondRoot, middle, leaf
    }
  },
);

test(
  '嵌套和并发调用均有独立快照预算，兼容默认 1000 个值、显式 1000 与不限量',
  { timeout: 15000 },
  async (t) => {
    const fixture = `
    import http from 'node:http';
    // 数组容器也计一个值。这个输入包含 1 + 4*(1 + 15*16) + 2*17 = 999 个值。
    const base = [
      ...Array.from({length: 4}, () => Array.from({length: 15}, () => Array(15).fill(1))),
      Array(16).fill(2), Array(16).fill(3),
    ];
    const exact = [...base, '第1000个值'];
    const overflow = [...exact, '第1001个值'];
    async function measure(input) { await Promise.resolve(); return input.length; }
    async function nested(input) {
      const sizes = await Promise.all([measure(overflow), measure(exact), measure(input)]);
      return sizes[0] + sizes[1] + sizes[2];
    }
    function inspect(options) { return options; }
    async function handler() {
      inspect({ password: 'private-value', text: 'x'.repeat(300), get accessor() { throw new Error('unexpected getter'); }, deep: [[[[['value']]]]], many: Array(20).fill(1) });
      return nested(base);
    }
    http.createServer(async (_req, res) => res.end(String(await handler()))).listen(0, '127.0.0.1');
  `;
    const routes = [
      {
        id: 'items',
        method: 'GET',
        path: '/items/:id',
        roots: ['src/index.mts:' + fixture.indexOf('async function handler')],
      },
    ];
    for (const [name, projectRoutes, limits] of [
      ['旧版单接口会话', undefined, undefined],
      ['项目会话未配置', routes, undefined],
      ['项目会话显式 1000', routes, { maxSnapshotValuesPerCall: 1000 }],
      ['项目会话两项设为 0', routes, { maxCallsPerRequest: 0, maxSnapshotValuesPerCall: 0 }],
    ])
      await t.test(name, async (t) => {
        const { address, events, until } = await startFixture(t, fixture, projectRoutes, limits);
        assert.equal(await (await fetch(address + '/items/1')).text(), '21');
        await until(() => events.some((e) => e.type === 'end'));
        const entries = events.filter((e) => e.type === 'enter');
        const calls = entries.filter((e) => e.node.name === 'measure');
        assert.equal(calls.length, 3);
        const resultOf = (call) =>
          events.find((e) => e.type === 'leave' && e.callId === call.callId);
        const marker = '[已截断：本次方法调用达到 1000 个值]';
        const unlimited = limits?.maxSnapshotValuesPerCall === 0;
        assert.deepEqual(calls[0].args[0].value.slice(-2), [
          '第1000个值',
          unlimited ? '第1001个值' : marker,
        ]);
        assert.equal(calls[1].args[0].value.at(-1), '第1000个值');
        assert.deepEqual(
          calls.map((c) => resultOf(c).result),
          unlimited ? [8, 7, 6] : [marker, marker, 6],
        );
        const inspected = entries.find((e) => e.node.name === 'inspect');
        const options = inspected.args[0].value;
        assert.equal(options.password, '[已遮蔽]');
        assert.equal(options.text, 'x'.repeat(240) + '…');
        assert.equal(options.accessor, '[访问器]');
        assert.equal(options.deep[0][0][0], '[达到深度上限]');
        assert.deepEqual(options.many, [...Array(16).fill(1), '[已截断]']);
        assert.deepEqual(resultOf(inspected).result, options);
        assert.equal(resultOf(entries.find((e) => e.node.name === 'nested')).result, 21);
        for (const call of entries) {
          assert.equal(resultOf(call).state, 'ok');
          assert.ok(resultOf(call).durationMs >= 0);
        }
        assert.equal(events.at(-1).dropped, 0);
      });
  },
);
