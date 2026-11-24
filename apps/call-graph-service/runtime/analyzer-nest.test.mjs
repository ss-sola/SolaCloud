import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { graphBuilder } from './analyzer-graph.mjs';
import { collectNestRoutes } from './analyzer-nest.mjs';

function fixture(t, sources) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sola-nest-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'src');
  fs.mkdirSync(source);
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
  );
  const files = Object.entries(sources).map(([name, text]) => {
    const file = path.join(source, name);
    fs.writeFileSync(file, text);
    return file.replaceAll('\\', '/');
  });
  return {
    root,
    ...collectNestRoutes({
      root,
      source,
      sourceFiles: files,
      sourceEntry: path.join(source, 'main.ts'),
    }),
  };
}

test('Nest selects registered controllers and resolves aliased decorators, RouterModule paths and injected services', (t) => {
  const project = fixture(t, {
    'main.ts': `
      import { NestFactory as Factory } from '@nestjs/core';
      import { App } from './modules.js';
      const app = await Factory.create(App);
      const prefix = 'api';
      app.setGlobalPrefix(prefix);
      throw new Error('static discovery must never run this entry');
    `,
    'modules.ts': `
      import * as nest from '@nestjs/common';
      import { RouterModule as Routing } from '@nestjs/core';
      import { Items as Api, Unused } from '@/items.js';
      const active = [Api];
      @nest.Module({ controllers: [...active] }) export class ItemsModule {}
      @nest.Module({ controllers: [Unused] }) export class Inactive {}
      const entries = [{ path: 'staff', children: [{ path: 'v1', module: ItemsModule }] }];
      @nest.Module({ imports: [Routing.register(entries), nest.forwardRef(() => ItemsModule)] }) export class App {}
    `,
    'items.ts': `
      import { Controller as C, Get as Read, RequestMapping as Route, RequestMethod as Verb, Sse } from '@nestjs/common';
      import { Store } from './store.js';
      const aliases = ['items','books'] as const;
      @C({ path: aliases })
      export class Items {
        constructor(private readonly store: Store) {}
        @Read(['by/:id','one/:id']) detail() { return this.store.lookup() }
        @Route({ method: Verb.POST, path: 'write' }) save() { return this.store.lookup() }
        @Sse('changes') changes() { return 2 }
      }
      @C('orphan') export class Unused { @Read() x() { return 1 } }
    `,
    'store.ts': 'export class Store { lookup() { return 1 } }',
  });
  const { root, catalog, syntax, program, warnings } = project;
  assert.deepEqual([...warnings], []);
  assert.equal(catalog.size, 8);
  assert.ok(catalog.has('GET /api/staff/v1/books/changes'));
  assert.ok(catalog.has('POST /api/staff/v1/items/write'));
  assert.ok(![...catalog.keys()].some((id) => id.includes('orphan')));
  const registrations = catalog.get('GET /api/staff/v1/items/by/:id');
  const graph = graphBuilder(root, syntax, catalog, program)(registrations);
  const detail = graph.nodes.find((n) => n.name === 'Items.detail');
  const lookup = graph.nodes.find((n) => n.name === 'Store.lookup');
  assert.deepEqual(graph.roots, [detail.id]);
  assert.ok(graph.edges.some((e) => e.from === detail.id && e.to === lookup.id));
  assert.equal(registrations[0].entry.file, 'src/items.ts');
});

test('Nest reports dynamic metadata and skips unrelated decorators and unresolved route paths', (t) => {
  const { catalog, warnings } = fixture(t, {
    'main.ts': `
      import { NestFactory } from '@nestjs/core';
      import { Module, Controller, Get } from '@nestjs/common';
      import { Get as Different } from 'not-nest';
      @Controller('visible') class ControllerA {
        @Get() known() { return 1 }
        @Get(getPath()) unknown() { return 2 }
        @Different('other') other() { return 3 }
      }
      @Module({ controllers: [ControllerA, ...selectControllers()] }) class App {}
      const app = await NestFactory.create(App);
      app.setGlobalPrefix(getPrefix());
    `,
  });
  assert.deepEqual([...catalog.keys()], ['GET /visible']);
  assert.ok([...warnings].some((w) => w.includes('全局前缀')));
  assert.ok([...warnings].some((w) => w.includes('动态路由路径')));
  assert.ok([...warnings].some((w) => w.includes('动态控制器列表')));
});

test('Nest follows static DynamicModule returns and method-specific global prefix exclusions', (t) => {
  const { catalog, warnings } = fixture(t, {
    'main.ts': `
      import {NestFactory} from '@nestjs/core';
      import {Controller, Get, Post, Module, RequestMethod} from '@nestjs/common';
      class Base { @Get('state') inspect() {return 1} }
      @Controller('system') class Health extends Base { @Post('state') change() {return 1} }
      @Module({}) class Feature {
        static register() { return {module: Feature,controllers: [Health]} }
      }
      @Module({imports:[Feature.register()]}) class Root {}
      const app = await NestFactory.create(Root);
      app.setGlobalPrefix('api', {exclude:[{path:'system/state',method:RequestMethod.GET}]});
    `,
  });
  assert.deepEqual([...warnings], []);
  assert.deepEqual([...catalog.keys()].sort(), ['GET /system/state', 'POST /api/system/state']);
});
