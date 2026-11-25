import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAnalyzer } from './analyzer.mjs';

test('同步计算沿真实依赖传播；类方法、实例方法和模块函数使用相同判据', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-computation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(
    path.join(root, 'src/api.ts'),
    `
    import Router from '@koa/router';
    import { db, client } from 'external-clients';
    const router = new Router();
    const scale = (x: number) => x * 2;
    class Tools { static normalize(n: number) { return Math.floor(scale(n)) } add(n: number) {return scale(n)+1} static query() {return db.get()} }
    function wrap() {return Tools.query()}
    function network() {return client.fetch()}
    function schedule() {setTimeout(() => 1, 10)}
    async function suspend() {return await scale(1)}
    function later() {return Promise.resolve(3)}
    const pending = Promise.resolve(2);
    function cached(maybe: boolean) {return maybe ? pending : 2}
    function transform(list: number[]) {return list.map(scale)}
    function delegate(cb: () => number) {return cb()}
    function unknown(source) {return source.map(scale)}
    function recurse(n: number): number {return n ? recurse(n-1) : 0}
    const tools = new Tools();
    router.get('/sample', () => [
      Tools.normalize(1), tools.add(1), wrap(), network(), schedule(), suspend(), later(),
      transform([2]), delegate(() => 3), unknown(client), recurse(3),cached(false)
    ]);
  `,
  );
  const g = createAnalyzer(root).graph('GET /sample');
  const flags = new Map(g.nodes.map((n) => [n.name, n.computationOnly]));
  for (const name of ['scale', 'Tools.normalize', 'Tools.add', 'transform'])
    assert.equal(flags.get(name), true, name);
  for (const name of [
    'Tools.query',
    'wrap',
    'network',
    'schedule',
    'suspend',
    'later',
    'delegate',
    'unknown',
    'recurse',
    'cached',
  ])
    assert.equal(flags.get(name), false, name);
});

test('目录联接指向项目时保持同一源码坐标，拒绝跨项目的 src 联接', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-linked-project-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const real = path.join(tmp, 'actual');
  const link = path.join(tmp, 'project-link');
  const outside = path.join(tmp, 'outside');
  fs.mkdirSync(path.join(real, 'src'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(
    path.join(real, 'src/api.ts'),
    "import Router from '@koa/router';const router=new Router();router.get('/test', () => 1);",
  );
  try {
    fs.symlinkSync(real, link, 'junction');
    fs.symlinkSync(path.join(real, 'src'), path.join(outside, 'src'), 'junction');
  } catch (err) {
    if (err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
    t.skip('当前账户不能创建目录联接');
    return;
  }
  assert.deepEqual(
    createAnalyzer(link).graph('GET /test'),
    createAnalyzer(real).graph('GET /test'),
  );
  assert.throws(() => createAnalyzer(outside), /目录外/);
});

test('目录挂载、别名、注册包装及不同回调绑定共享源码坐标', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-route-analysis-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(name, text) {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, text);
  }
  write(
    'package.json',
    JSON.stringify({ type: 'module', imports: { '#service/*': './src/service/*' } }),
  );
  write('src/controller/index.ts', 'export class RootRouterLoader {}');
  write('src/controller/api/__test__/fake.ts', 'throw new Error("测试文件不应扫描")');
  write('src/controller/api/index.ts', 'throw new Error("入口文件不应扫描")');
  write(
    'src/controller/api/v1/list.ts',
    `
    import Router from '@koa/router';
    import { Handler } from '#service/handler.ts';
    if (true) throw Error('扫描不得执行项目源码');
    export const router = new Router({ prefix: '/v1/items' });
    const guard = () => async (ctx, next) => next();
    function add(path, run) { router.get(path, guard(), ctx => run(ctx)); }
    add(['/list','/:id'], item => Handler.read(item));
    router.del('/:id', ctx => Handler.remove(ctx));
    router.post('/both', () => { apply(Handler.read); apply(Handler.remove) });
    function apply(callback) { return callback(1) }
  `,
  );
  const service =
    'export class Handler { static read(x) { return this.decode(x) } static decode(x) { return x } static remove(x) { return x } }';
  write('src/service/handler.ts', service);
  write(
    'src/controller/wechat-api/v1/test.ts',
    `
    import Router from '@koa/router';
    const router = new Router({ prefix: '/v1' });
    for (const [method, path] of [['POST','/loop']] as const) {
      router.register(path, [method], [ctx => ctx.body]);
    }
  `,
  );
  const a = createAnalyzer(root);
  assert.deepEqual(a.routes.map((r) => r.id).sort(), [
    'DELETE /api/v1/items/:id',
    'GET /api/v1/items/:id',
    'GET /api/v1/items/list',
    'POST /api/v1/items/both',
    'POST /wechat-api/v1/loop',
  ]);
  const graph = a.graph('GET /api/v1/items/list');
  const manifest = a.probeRoutes();
  assert.equal(manifest.length, a.routes.length);
  for (const route of manifest) {
    assert.deepEqual(route.roots, a.graph(route.id).roots);
    assert.deepEqual(Object.keys(route).sort(), ['id', 'method', 'path', 'roots']);
  }
  assert.equal(graph.roots.length, 2);
  const read = graph.nodes.find((n) => n.name === 'Handler.read');
  const decode = graph.nodes.find((n) => n.name === 'Handler.decode');
  assert.equal(read.id, 'src/service/handler.ts:' + service.indexOf('static read'));
  assert.ok(graph.edges.some((edge) => edge.from === read.id && edge.to === decode.id));
  assert.ok(!graph.nodes.some((n) => n.name === 'Handler.remove'));
  const both = a.graph('POST /api/v1/items/both');
  const helper = both.nodes.find((n) => n.name === 'apply');
  const callbacks = both.edges
    .filter((e) => e.from === helper.id)
    .map((e) => both.nodes.find((n) => n.id === e.to).name)
    .sort();
  assert.deepEqual(callbacks, ['Handler.read', 'Handler.remove']);
  assert.throws(() => a.graph('GET /missing'), /接口/);
});

test('按已安装的 CopilotKit 版本和实际挂载地址展开，未知版本仍可追踪', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-agui-analysis-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of [
    'src/ag-ui',
    'src/bootstrap',
    'src/controller',
    'node_modules/@copilotkit/runtime',
  ])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  const write = (file, text) => fs.writeFileSync(path.join(root, file), text);
  write('src/controller/index.ts', 'export class RootRouterLoader {}');
  write('src/bootstrap/http.ts', 'app.use(agUiMiddleware());');
  write(
    'src/ag-ui/index.ts',
    `export function agUiMiddleware() {
    return async function agUiKoaMiddleware(ctx) {
      const runtime = new CopilotSseRuntime({});
      return createCopilotRuntimeHandler({runtime, basePath: '/mounted'});
    }
  }`,
  );
  write('node_modules/@copilotkit/runtime/package.json', '{"version":"1.88.0"}');
  const a = createAnalyzer(root);
  assert.equal(a.routes.length, 20);
  assert.ok(!a.routes.some((r) => r.path.includes('/memories')));
  assert.equal(
    a.graph('POST /mounted/agent/:agentId/stop/:threadId').nodes[0].name,
    'agUiKoaMiddleware',
  );
  assert.ok(a.routes.some((r) => r.id === 'GET /mounted/info'));
  write('node_modules/@copilotkit/runtime/package.json', '{"version":"2.0.0"}');
  const future = createAnalyzer(root);
  assert.deepEqual(
    future.routes.map((r) => r.id),
    ['ALL /mounted/:path(.*)'],
  );
  assert.ok(future.warnings.length);
});

test('静态调用图把惰性创建的 BullMQ 队列和独立 Worker 接到入队方法，忽略普通 add', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-bullmq-graph-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  const write = (file, source) => fs.writeFileSync(path.join(root, file), source);
  write(
    'package.json',
    JSON.stringify({
      type: 'module',
      dependencies: { koa: '3' },
      scripts: { 'start:worker': 'node src/processor.mjs' },
    }),
  );
  write(
    'src/queue.ts',
    `
    import { Queue as BullQueue } from 'bullmq';
    export const Names = Object.freeze({ Archive: 'archive' });
    let queue;
    export function getQueue() {
      if (!queue) queue = new BullQueue(Names.Archive).on('error', () => {});
      return queue;
    }
  `,
  );
  write(
    'src/api.ts',
    `
    import Router from '@koa/router';
    import { getQueue } from './queue.ts';
    const router = new Router();
    const job = 'zip';
    class ExportService {
      static async submit() {
        new Set().add(job);
        await getQueue().add(job, {});
      }
    }
    router.get('/archive', () => ExportService.submit());
  `,
  );
  write(
    'src/processor.mjs',
    `
    import * as bull from 'bullmq';
    async function packageArchive() {}
    new bull.Worker('archive', async () => packageArchive());
    new bull.Worker('another', async () => unrelated());
    async function unrelated() {}
  `,
  );
  const graph = createAnalyzer(root).graph('GET /archive');
  const id = (name) => graph.nodes.find((node) => node.name === name)?.id;
  const queue = graph.nodes.find((node) => node.kind === 'queue');
  const worker = graph.nodes.find((node) => node.kind === 'worker');
  assert.equal(queue?.name, 'BullMQ 入队 · archive / zip');
  assert.equal(worker?.name, 'BullMQ Worker · archive / zip · 第 1 次');
  assert.ok(
    graph.edges.some((edge) => edge.from === id('ExportService.submit') && edge.to === queue.id),
  );
  assert.ok(graph.edges.some((edge) => edge.from === queue.id && edge.to === worker.id));
  const handler = graph.edges.find((edge) => edge.from === worker.id)?.to;
  assert.ok(graph.edges.some((edge) => edge.from === handler && edge.to === id('packageArchive')));
  assert.ok(!id('unrelated'));
});
