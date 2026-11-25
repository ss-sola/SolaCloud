import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAnalyzer } from './analyzer.mjs';
import { selectProjectStrategy } from './project-strategies.mjs';

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sola-framework-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(relative, text) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return { root, write };
}

test('真实入口、依赖、源码依次辨别框架，未支持或有歧义的项目给出提示', (t) => {
  const { root, write } = project(t);
  write(
    'src/example.ts',
    "import type Router from '@koa/router'; import { Logger } from '@nestjs/common'; throw new Error('must not execute');",
  );
  let a = createAnalyzer(root);
  assert.equal(a.framework, 'unknown');
  assert.deepEqual(a.routes, []);
  assert.match(a.warnings[0], /未识别/);
  write(
    'src/routes.ts',
    "import Router from '@koa/router'; const router = new Router(); router.get('/read', () => 7)",
  );
  assert.equal(createAnalyzer(root).routes[0].id, 'GET /read');
  write('package.json', JSON.stringify({ dependencies: { koa: '3', '@nestjs/core': '11' } }));
  assert.equal(selectProjectStrategy(root).framework, 'koa');
  write('src/index.ts', "import Koa from 'koa';");
  write('src/main.ts', "import { NestFactory } from '@nestjs/core';");
  assert.match(createAnalyzer(root).warnings[0], /多个框架/);
  write('src/index.ts', "import './routes.js';");
  assert.equal(selectProjectStrategy(root).framework, 'nestjs');
});

test('NestJS 启动入口遵循项目内静态 start 脚本和编译目录，保留 Koa 入口约定', (t) => {
  const { root, write } = project(t);
  write(
    'package.json',
    JSON.stringify({
      dependencies: { '@nestjs/core': '11' },
      scripts: { start: 'node --enable-source-maps "output/api.cjs"' },
    }),
  );
  write('nest-cli.json', JSON.stringify({ sourceRoot: 'app', entryFile: 'boot' }));
  write('app/boot.ts', "import { NestFactory } from '@nestjs/core';");
  assert.equal(selectProjectStrategy(root).entry, 'output/api.cjs');
  write(
    'package.json',
    JSON.stringify({
      dependencies: { '@nestjs/core': '11' },
      scripts: { start: 'node ../outside.js' },
    }),
  );
  write('tsconfig.json', '{"compilerOptions":{"outDir":"./lib"}}');
  write('lib/app/boot.js', 'throw new Error("scan must not start the project")');
  assert.equal(selectProjectStrategy(root).entry, 'lib/app/boot.js');
});

test('自动识别声明的 BullMQ 启动入口，跳过同进程、重复入口和无法确认的脚本', (t) => {
  const { root, write } = project(t);
  write(
    'package.json',
    JSON.stringify({
      dependencies: { koa: '3' },
      scripts: {
        start: 'node src/index.ts',
        'start:included': 'node src/included.cjs',
        'worker:mail': 'pnpm run dispatch',
        dispatch: 'node --enable-source-maps "output/send mail.mjs"',
        'worker:jobs': 'node output/jobs.cjs',
        'worker:nested': 'node output/nested.cjs',
        'worker:http': 'node output/http.cjs',
        'worker:missing': 'node output/missing.js',
        'worker:outside': 'node ../outside.js',
        'worker:opaque': 'node output/nested.cjs && node output/jobs.cjs',
        'worker:test': 'node output/test.cjs',
      },
    }),
  );
  write('src/index.ts', "import '@koa/router'; import './included.cjs';");
  write('src/included.cjs', "const { Worker } = require('bullmq'); new Worker();");
  write(
    'output/send mail.mjs',
    "import './processor.mjs'; throw new Error('scan must not launch it');",
  );
  write('output/processor.mjs', "import { Worker as Consumer } from 'bullmq'; new Consumer();");
  write('output/jobs.cjs', "require('./nested.cjs');");
  write('output/nested.cjs', "const Consumer = require('bullmq').Worker; new Consumer();");
  write(
    'output/http.cjs',
    "const { Worker } = require('bullmq'); new Worker(); require('node:http').createServer().listen(80);",
  );
  write('output/test.cjs', "const { Worker } = require('bullmq'); new Worker();");
  const { workerEntries, warnings } = createAnalyzer(root);
  assert.deepEqual(workerEntries, ['output/send mail.mjs', 'output/jobs.cjs']);
  assert.equal(warnings.filter((warning) => warning.includes('BullMQ')).length, 3);
});

test('Nest 独立应用上下文中的 BullMQ Processor 可作为独立入口', (t) => {
  const { root, write } = project(t);
  write(
    'package.json',
    JSON.stringify({
      dependencies: { '@nestjs/core': '11' },
      scripts: {
        'start:prod': 'node dist/main.js',
        'worker:build': 'node dist/worker.js',
        'start:jobs': 'node dist/worker.js',
      },
    }),
  );
  write('src/main.ts', "import { NestFactory } from '@nestjs/core';");
  write(
    'dist/main.js',
    "const { NestFactory } = require('@nestjs/core'); NestFactory.create(AppModule);",
  );
  write(
    'dist/worker.js',
    "const core = require('@nestjs/core'); require('./processors'); core.NestFactory.createApplicationContext(QueueModule);",
  );
  write(
    'dist/processors.js',
    "const bull = require('@nestjs/bullmq'); (0, bull.Processor)('jobs');",
  );
  assert.deepEqual(createAnalyzer(root).workerEntries, ['dist/worker.js']);
});
