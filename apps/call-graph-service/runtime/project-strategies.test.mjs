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
