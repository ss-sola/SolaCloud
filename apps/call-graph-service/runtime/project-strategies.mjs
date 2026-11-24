import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript-compiler';
import { collectKoaRoutes, hasRootRouterLoader } from './analyzer-koa.mjs';
import { collectNestRoutes } from './analyzer-nest.mjs';
import { inProject, sourceFiles } from './analyzer-source.mjs';

function readConfig(root, name) {
  const file = path.join(root, name);
  if (!inProject(root, file) || !fs.statSync(file).isFile()) return {};
  return ts.parseConfigFileTextToJson(file, fs.readFileSync(file, 'utf8')).config ?? {};
}

function inRoot(root, file) {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function importedPackages(file) {
  if (!file) return [];
  const text = fs.readFileSync(file, 'utf8');
  if (!/['"](?:@nestjs\/|koa(?:-router)?['"]|@koa\/router['"])/.test(text)) return [];
  const packages = [];
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  for (const stmt of ast.statements) {
    if (!ts.isImportDeclaration(stmt) || stmt.importClause?.isTypeOnly) continue;
    const mod = stmt.moduleSpecifier.text;
    const named = stmt.importClause?.namedBindings;
    if (
      named &&
      ts.isNamedImports(named) &&
      !named.elements.some((e) => !e.isTypeOnly) &&
      !stmt.importClause?.name
    )
      continue;
    if (
      mod === '@nestjs/common' &&
      !(
        named &&
        (ts.isNamespaceImport(named) ||
          named.elements.some(
            (e) => !e.isTypeOnly && (e.propertyName ?? e.name).text === 'Controller',
          ))
      )
    )
      continue;
    packages.push(mod);
  }
  if (/\brequire\s*\(/.test(text)) {
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      )
        packages.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return packages;
}

function sourceEntry(root, source, base) {
  return ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']
    .map((ext) => path.resolve(source, base + ext))
    .find((file) => inProject(root, file) && fs.statSync(file).isFile());
}

function nodeScriptEntry(script) {
  if (typeof script !== 'string') return;
  // Read a static executable path only. Never evaluate the project's start script.
  const match =
    /^\s*node\s+(?:--enable-source-maps\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))\s*$/.exec(script);
  return match?.slice(1).find(Boolean);
}

function nestEntry({ root, source, main, manifest, nestConfig }) {
  const tsConfig = readConfig(root, 'tsconfig.json');
  const out = tsConfig.compilerOptions?.outDir ?? 'dist';
  const base = nestConfig.entryFile ?? 'main';
  const compiled = main?.endsWith('.mts') ? '.mjs' : main?.endsWith('.cts') ? '.cjs' : '.js';
  const candidates = [
    nodeScriptEntry(manifest.scripts?.['start:prod']),
    nodeScriptEntry(manifest.scripts?.start),
    path.join(out, base + compiled),
    path.join(out, path.relative(root, source), base + compiled),
  ]
    .filter((name) => typeof name === 'string' && /\.[cm]?js$/i.test(name))
    .map((name) => path.resolve(root, name))
    .filter(
      (file) =>
        inRoot(root, file) && !path.relative(root, file).split(path.sep).includes('node_modules'),
    );
  return (
    candidates.find((file) => inProject(root, file) && fs.statSync(file).isFile()) ?? candidates[0]
  );
}

const strategies = [
  {
    framework: 'koa',
    module: (name) => ['koa', 'koa-router', '@koa/router'].includes(name),
    sourceEntry: () => 'index',
    marker: ({ root, source }) => hasRootRouterLoader(root, source),
    entry: ({ root, main }) => main ?? path.join(root, 'src/index.ts'),
    collect: collectKoaRoutes,
  },
  {
    framework: 'nestjs',
    module: (name) => name === '@nestjs/core',
    sourceModule: (name) => name === '@nestjs/core' || name === '@nestjs/common',
    sourceEntry: (nestConfig) => nestConfig.entryFile ?? 'main',
    marker: ({ hasNestConfig }) => hasNestConfig,
    entry: nestEntry,
    collect: collectNestRoutes,
  },
];

/** Compare source entry imports first, declared framework dependencies second,
 * and source imports last for small projects without a manifest. */
export function selectProjectStrategy(project) {
  const root = fs.realpathSync(project);
  const manifest = readConfig(root, 'package.json');
  const hasNestConfig = inProject(root, path.join(root, 'nest-cli.json'));
  const nestConfig = hasNestConfig ? readConfig(root, 'nest-cli.json') : {};
  const defaultSource = fs.existsSync(path.join(root, 'src')) ? 'src' : '.';
  const dependencies = Object.keys(manifest.dependencies ?? {});
  const devDependencies = Object.keys(manifest.devDependencies ?? {});
  const candidates = strategies.map((strategy) => {
    const nest = strategy.framework === 'nestjs';
    const source = path.resolve(
      root,
      nest ? (nestConfig.sourceRoot ?? defaultSource) : defaultSource,
    );
    if (!inRoot(root, source) || !inProject(root, source))
      throw new Error('源码目录链接到了项目目录外或目录不存在');
    const main = sourceEntry(root, source, strategy.sourceEntry(nestConfig));
    const imports = importedPackages(main);
    const rank = imports.some(strategy.module)
      ? 4
      : dependencies.some(strategy.module) || strategy.marker({ root, source, hasNestConfig })
        ? 3
        : devDependencies.some(strategy.module)
          ? 2
          : 0;
    return { strategy, root, source, main, manifest, nestConfig, rank };
  });
  let best = Math.max(...candidates.map((item) => item.rank));
  if (!best || candidates.filter((item) => item.rank === best).length > 1) {
    const importsByDir = new Map();
    for (const item of candidates.filter((candidate) => candidate.rank === best)) {
      if (!importsByDir.has(item.source)) {
        const modules = new Set();
        for (const file of sourceFiles(item.source))
          for (const name of importedPackages(file)) modules.add(name);
        importsByDir.set(item.source, [...modules]);
      }
      if (importsByDir.get(item.source).some(item.strategy.sourceModule ?? item.strategy.module))
        item.rank++;
    }
    best = Math.max(...candidates.map((item) => item.rank));
  }
  const matches = candidates.filter((item) => item.rank === best);
  if (!best || matches.length !== 1) {
    return {
      framework: 'unknown',
      warning: best
        ? '检测到多个框架入口，请选择单个应用的项目目录。'
        : '未识别到支持的项目类型，目前支持 Koa 和 NestJS。',
    };
  }
  const descriptor = matches[0];
  const { strategy, source, main } = descriptor;
  const executable = strategy.entry(descriptor);
  return {
    root,
    framework: strategy.framework,
    entry: executable && path.relative(root, executable).split(path.sep).join('/'),
    discover: () => strategy.collect({ root, source, sourceFiles, sourceEntry: main }),
  };
}
