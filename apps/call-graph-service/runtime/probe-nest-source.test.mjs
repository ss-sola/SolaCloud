import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript-compiler';
import { createAnalyzer } from './analyzer.mjs';
import { instrumentNest } from './probe-nest-source.mjs';

const require = createRequire(import.meta.url);
const rootName = 'demo.controller';
const modules = {
  main: `import 'reflect-metadata';
    import { Module } from '@nestjs/common';
    import { NestFactory } from '@nestjs/core';
    import { DemoController } from './demo.controller.js';
    import { CalcService } from './calc.service.js';
    @Module({ controllers: [DemoController], providers: [CalcService] }) class AppModule {}
    async function bootstrap() {
      const app = await NestFactory.create(AppModule, { logger: false });
      await app.listen(0, '127.0.0.1');
    }
    void bootstrap();`,
  [rootName]: `import { Controller, Get, Inject, Param } from '@nestjs/common';
    import { CalcService } from './calc.service.js';
    @Controller('demo') export class DemoController {
      constructor(@Inject(CalcService) private service: CalcService) {}
      @Get(':id')
      async check(@Param('id') id: string) { return { value: await this.service.calc(Number(id)) }; }
    }`,
  'calc.service': `import { Injectable } from '@nestjs/common';
    import { once } from 'node:events';
    @Injectable() export class CalcService {
      async calc(input: number) { await once(process, 'message'); return this.twice(input); }
      private twice(value: number) { return value * 2; }
    }`,
};

function project(t, stop) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sola-probe-nest-')));
  t.after(async () => {
    await stop?.();
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'dist'));
  return root;
}

test('外置与内联 tsc map 使用真实 sourceRoot，陈旧、缺失或跨项目的映射保留原 JS', (t) => {
  const root = project(t);
  const text = 'class Demo {\n  async check(value: number) { return value + 1; }\n}';
  const tsFile = path.join(root, 'src/demo.ts'),
    file = path.join(root, 'dist/demo.js');
  fs.writeFileSync(tsFile, text);
  const out = ts.transpileModule(text, {
    fileName: 'demo.ts',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      sourceMap: true,
      inlineSources: true,
    },
  });
  const map = JSON.parse(out.sourceMapText);
  map.sourceRoot = '../src';
  map.sources = ['demo.ts'];
  const source = out.outputText.replace(
    'sourceMappingURL=demo.js.map',
    'sourceMappingURL=maps/demo.js.map',
  );
  fs.mkdirSync(path.join(root, 'dist/maps'));
  fs.writeFileSync(file, source);
  const external = path.join(root, 'dist/maps/demo.js.map');
  fs.writeFileSync(external, JSON.stringify({ ...map, sourceRoot: '../../src' }));
  function check(code) {
    const warnings = new Set();
    const result = instrumentNest(root, file, code, (reason) => warnings.add(reason));
    return { result, warnings };
  }
  const id = 'src/demo.ts:' + text.indexOf('async check');
  assert.ok(check(source).result.includes(JSON.stringify(id)));
  const otherClass = source.replace('class Demo', 'class Else');
  assert.notEqual(source, otherClass);
  assert.deepEqual(check(otherClass), { result: otherClass, warnings: new Set(['method']) });
  const inline = (data) =>
    out.outputText.replace(
      'demo.js.map',
      'data:application/json;charset=utf-8;base64,' +
        Buffer.from(JSON.stringify(data)).toString('base64'),
    );
  assert.ok(check(inline(map)).result.includes(JSON.stringify(id)));
  assert.equal(
    check(source.replace('maps/demo.js.map', 'missing.map')).result,
    source.replace('maps/demo.js.map', 'missing.map'),
  );
  for (const broken of [
    { ...map, sourcesContent: ['// old source'] },
    { ...map, sourceRoot: '../../../outside' },
    { ...map, mappings: '' },
  ]) {
    const code = inline(broken);
    const { result, warnings } = check(code);
    assert.equal(result, code);
    assert.ok(warnings.size);
  }
  delete map.sourcesContent;
  const noEmbedded = inline(map);
  assert.ok(check(noEmbedded).result.includes(JSON.stringify(id)));
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(tsFile, future, future);
  assert.equal(check(noEmbedded).result, noEmbedded);
});

// SWC is an optional peer of Nest CLI. The tsc map tests above run for every installation.
let swc;
try {
  swc = createRequire(require.resolve('@nestjs/cli/package.json'))('@swc/core');
} catch {}

test(
  '真实 Nest SWC ESM 项目并发处理两次 HTTP 请求，控制器与注入服务关联到 TS 源码',
  { skip: !swc, timeout: 20000 },
  async (t) => {
    let child;
    const root = project(t, async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'exit');
        child.kill();
        await closed;
      }
    });
    for (const pkg of [
      'reflect-metadata',
      '@nestjs/core',
      '@nestjs/common',
      '@nestjs/platform-express',
    ]) {
      const dest = path.join(root, 'node_modules', pkg);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let resolved = path.dirname(require.resolve(pkg));
      while (!fs.existsSync(path.join(resolved, 'package.json'))) resolved = path.dirname(resolved);
      fs.symlinkSync(resolved, dest, process.platform === 'win32' ? 'junction' : 'dir');
    }
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        type: 'module',
        dependencies: { '@nestjs/common': '*', '@nestjs/core': '*' },
      }),
    );
    fs.writeFileSync(path.join(root, 'nest-cli.json'), JSON.stringify({ sourceRoot: 'src' }));
    for (const [name, text] of Object.entries(modules)) {
      const tsFile = path.join(root, 'src', name + '.ts');
      const jsFile = path.join(root, 'dist', name + '.js');
      fs.writeFileSync(tsFile, text);
      const built = swc.transformSync(text, {
        filename: tsFile,
        sourceFileName: '../src/' + name + '.ts',
        sourceMaps: true,
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
        },
        module: { type: 'es6' },
      });
      fs.writeFileSync(jsFile, built.code + '\n//# sourceMappingURL=' + name + '.js.map');
      fs.writeFileSync(jsFile + '.map', built.map);
    }
    const expected = [
      ['DemoController.check', 'demo.controller', "@Get(':id')"],
      ['CalcService.calc', 'calc.service', 'async calc('],
      ['CalcService.twice', 'calc.service', 'private twice('],
    ].map(([name, stem, at]) => ({ name, id: 'src/' + stem + '.ts:' + modules[stem].indexOf(at) }));
    const analyzer = createAnalyzer(root);
    const route = analyzer.probeRoutes().find((r) => r.id === 'GET /demo/:id');
    assert.deepEqual(route?.roots, [expected[0].id]);
    const graph = analyzer.graph(route.id);
    for (const node of expected)
      assert.ok(
        graph.nodes.some((n) => n.name === node.name && n.id === node.id),
        node.name,
      );
    const entry = 'dist/main.js';
    child = fork(path.join(root, entry), {
      cwd: root,
      execArgv: ['--import', new URL('./probe.mjs', import.meta.url).href],
      env: { ...process.env, SOLA_CALL_GRAPH_PROJECT: '1' },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const events = [];
    child.on('message', (value) => {
      if (value.type === 'events') events.push(...value.events);
      else events.push(value);
    });
    async function until(done) {
      try {
        while (!done()) await once(child, 'message', { signal: AbortSignal.timeout(8000) });
      } catch (cause) {
        throw new Error(
          '探针未收到所需事件：' +
            events.map((e) => e.node?.name ?? e.message ?? e.type).join(', ') +
            '；子进程退出码 ' +
            child.exitCode,
          { cause },
        );
      }
    }
    child.send({ type: 'configure', framework: 'nestjs', entry, routes: [route] });
    await until(() => events.some((e) => e.type === 'listening'));
    const port = events.find((e) => e.type === 'listening').port;
    const requests = Promise.all(
      [3, 7].map(async (n) => (await fetch('http://127.0.0.1:' + port + '/demo/' + n)).json()),
    );
    await until(
      () =>
        events.filter((e) => e.type === 'enter' && e.node.name === 'CalcService.calc').length === 2,
    );
    child.send('continue');
    assert.deepEqual(await requests, [{ value: 6 }, { value: 14 }]);
    await until(() => events.filter((e) => e.type === 'end').length === 2);
    const incoming = events.filter((e) => e.type === 'request');
    assert.equal(new Set(incoming.map((e) => e.requestId)).size, 2);
    for (const req of incoming) {
      const n = Number(req.path.split('/').at(-1));
      const trace = events.filter((e) => e.requestId === req.requestId);
      const enters = trace.filter((e) => e.type === 'enter');
      assert.equal(req.routeId, route.id);
      assert.deepEqual(req.parameters, { query: {} });
      assert.deepEqual(trace.find((e) => e.type === 'requestParams')?.parameters.path, {
        id: String(n),
      });
      assert.deepEqual(
        enters.map((e) => ({ name: e.node.name, id: e.node.id })),
        expected,
      );
      assert.deepEqual(
        enters.map((e) => e.parentId),
        [null, enters[0].callId, enters[1].callId],
      );
      assert.deepEqual(
        enters.map((e) => e.args[0]),
        [
          { name: 'id', value: String(n) },
          { name: 'input', value: n },
          { name: 'value', value: n },
        ],
      );
      const leaves = trace.filter((e) => e.type === 'leave');
      assert.deepEqual(
        leaves.map((e) => e.callId),
        enters.map((e) => e.callId).reverse(),
      );
      assert.deepEqual(
        leaves.map((e) => e.result),
        [n * 2, n * 2, { value: n * 2 }],
      );
      assert.ok(leaves.every((e) => e.durationMs >= 0 && e.state === 'ok'));
      assert.equal(trace.at(-1).status, 200);
      assert.equal(trace.at(-1).dropped, 0);
    }
  },
);
