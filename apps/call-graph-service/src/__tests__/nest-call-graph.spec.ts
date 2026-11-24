import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Response } from 'express';
import ts from 'typescript-compiler';
import { expect, it, vi } from 'vitest';
import { DEFAULT_PROBE_LIMITS } from '../constants/probe-limits.constants';
import { ProbeProcessService } from '../modules/call-graph/probe-process.service';
import type { ProbeEvent } from '../modules/call-graph/probe-session';
import { ProjectAnalysisService } from '../modules/call-graph/project-analysis.service';

const config = vi.hoisted(() => ({ project: '' }));
vi.mock('@nest-cloud/sdk', async (original) => ({
  ...(await original<typeof import('@nest-cloud/sdk')>()),
  getConfig: () => config.project,
}));

const files = {
  main: `import './unmapped';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {logger:false});
  await app.listen(0, '127.0.0.1');
}
void bootstrap();`,
  unmapped: 'export const formatVersion = 2;',
  'app.module': `import {Module} from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
@Module({controllers:[HealthController],providers:[HealthService]})
export class AppModule {}`,
  'health.controller': `import { Controller, Get } from '@nestjs/common';
import {HealthService} from './health.service';
@Controller('health')
export class HealthController {
  constructor(private readonly health:HealthService) {}
  @Get('check')
  check(){ return this.health.answer(21); }
}`,
  'health.service': `import {Injectable} from '@nestjs/common';
@Injectable()
export class HealthService {
  answer(value:number){ return {answer:value*2}; }
}`,
};

async function nestProject(project: string) {
  await mkdir(path.join(project, 'src'));
  const scope = path.join(project, 'node_modules', '@nestjs');
  await mkdir(scope, { recursive: true });
  for (const name of ['common', 'core', 'platform-express']) {
    const pkg = path.dirname(require.resolve('@nestjs/' + name + '/package.json'));
    await symlink(pkg, path.join(scope, name), 'junction');
  }
  await writeFile(
    path.join(project, 'package.json'),
    JSON.stringify({ dependencies: { '@nestjs/core': '*', '@nestjs/common': '*' } }),
  );
  await writeFile(path.join(project, 'nest-cli.json'), JSON.stringify({ sourceRoot: 'src' }));
  await writeFile(
    path.join(project, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'commonjs',
        target: 'ES2022',
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        outDir: 'dist',
        rootDir: 'src',
        sourceMap: true,
      },
    }),
  );
  for (const [name, source] of Object.entries(files))
    await writeFile(path.join(project, 'src', name + '.ts'), source);
}

async function buildProject(project: string) {
  const out = path.join(project, 'dist');
  await mkdir(out);
  for (const [name, source] of Object.entries(files)) {
    const result = ts.transpileModule(source, {
      fileName: name + '.ts',
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        sourceMap: true,
        inlineSources: true,
      },
    });
    const map = JSON.parse(result.sourceMapText!);
    map.sources = ['../src/' + name + '.ts'];
    await writeFile(path.join(out, name + '.js'), result.outputText);
    if (name !== 'unmapped') await writeFile(path.join(out, name + '.js.map'), JSON.stringify(map));
  }
}

it('扫描 NestJS 源码，在构建后启动真实 Nest HTTP 服务并使用源码方法标识记录请求', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'nest-call-graph-'));
  const analysis = new ProjectAnalysisService(),
    probes = new ProbeProcessService();
  config.project = project;
  try {
    await nestProject(project);
    const catalog = await analysis.scan(project);
    expect(catalog).toMatchObject({ framework: 'nestjs', entry: 'dist/main.js' });
    const route = catalog.routes.find((r) => r.method === 'GET' && r.path === '/health/check');
    expect(route).toBeDefined();
    const graph = await analysis.graph(project, route!.id);
    const target = await analysis.target(project);
    expect(target).toMatchObject({ framework: 'nestjs', entry: 'dist/main.js' });
    expect(() => probes.start(7, target, DEFAULT_PROBE_LIMITS)).toThrow(/构建入口.*dist\/main\.js/);
    await buildProject(project);
    const { sessionId } = probes.start(7, target, DEFAULT_PROBE_LIMITS);
    const events: ProbeEvent[] = [];
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      writableLength: 0,
      set: vi.fn(),
      flushHeaders: vi.fn(),
      end: vi.fn(),
      write: (line: string) => {
        if (line.trim()) events.push(JSON.parse(line));
        return true;
      },
    });
    probes.owned(7, sessionId).stream(0, response as unknown as Response);
    const listening = () => events.find((e) => e.state === 'listening');
    await vi.waitFor(() => expect(listening()).toBeDefined(), { timeout: 9000 });
    const reply = await fetch('http://127.0.0.1:' + listening()!.port + route!.path);
    expect(await reply.json()).toEqual({ answer: 42 });
    expect(
      events.some((e) => e.type === 'warning' && String(e.message).includes('unmapped.js')),
    ).toBe(true);
    await vi.waitFor(() => expect(events.some((e) => e.type === 'end')).toBe(true));
    expect(events.find((e) => e.type === 'request')).toMatchObject({
      routeId: route!.id,
      path: '/health/check',
    });
    const controller = graph.nodes.find((n) => graph.roots.includes(n.id))!;
    const service = graph.nodes.find((n) => n.name.endsWith('answer'))!;
    const entered = (id: string) =>
      events.find((e) => e.type === 'enter' && (e.node as { id: string }).id === id);
    const root = entered(controller.id);
    expect(root).toBeDefined();
    expect(entered(service.id)).toMatchObject({ parentId: root!.callId });
    expect(events.find((e) => e.type === 'leave' && e.callId === root!.callId)).toMatchObject({
      state: 'ok',
      result: { answer: 42 },
    });
    expect(events.find((e) => e.type === 'end')).toMatchObject({ status: 200, dropped: 0 });
  } finally {
    await probes.onModuleDestroy();
    await analysis.onModuleDestroy();
    await rm(project, { recursive: true, force: true });
  }
}, 20000);

it('未知框架不能启动，构建目录链接和显式父路径都不能越过配置目录', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nest-entry-'));
  const project = path.join(tmp, 'app'),
    outside = path.join(tmp, 'outside');
  const analysis = new ProjectAnalysisService(),
    probes = new ProbeProcessService();
  config.project = project;
  try {
    await mkdir(project);
    await mkdir(outside);
    await writeFile(path.join(project, 'package.json'), '{}');
    await writeFile(path.join(project, 'index.js'), 'export const ok = true;');
    expect(await analysis.scan(project)).toMatchObject({ framework: 'unknown' });
    await expect(analysis.target(project)).rejects.toThrow('无法识别项目框架');
    await writeFile(path.join(outside, 'main.js'), 'throw Error("must not execute");');
    await symlink(outside, path.join(project, 'dist'), 'junction');
    const target = {
      project,
      framework: 'nestjs' as const,
      routes: [],
      computations: () => undefined,
    };
    for (const entry of ['dist/main.js', '../outside/main.js']) {
      expect(() => probes.start(7, { ...target, entry }, DEFAULT_PROBE_LIMITS)).toThrow(
        '项目入口超出配置目录',
      );
    }
  } finally {
    await analysis.onModuleDestroy();
    await probes.onModuleDestroy();
    await rm(tmp, { recursive: true, force: true });
  }
});
