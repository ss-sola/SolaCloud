import fs from 'node:fs';
import path from 'node:path';
import { pathToRegexp } from 'path-to-regexp';
import ts from 'typescript-compiler';
import { localProgram } from './analyzer-graph.mjs';
import { nestSource } from './analyzer-nest-source.mjs';
import { inProject } from './analyzer-source.mjs';

const slash = (s) => s.replaceAll('\\', '/');
const routePath = (...parts) =>
  ('/' + parts.join('/')).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
const verbs = new Set(
  'Get Post Put Delete Patch All Options Head Search Propfind Proppatch Mkcol Copy Move Lock Unlock'.split(
    ' ',
  ),
);

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function ancestry(cls, read) {
  const chain = new Set();
  while (cls && ts.isClassDeclaration(cls) && !chain.has(cls)) {
    chain.add(cls);
    const parent = cls.heritageClauses?.find(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    );
    cls = read.value(parent?.types[0]?.expression);
  }
  return [...chain];
}

export function collectNestRoutes({ root, source, sourceFiles, sourceEntry }) {
  const syntax = new Map();
  const catalog = new Map();
  const warnings = new Set();
  const files = typeof sourceFiles === 'function' ? sourceFiles(source) : sourceFiles;
  for (const file of files) {
    if (
      !inProject(root, file) ||
      /(?:[/\\](?:__mocks__|__tests__|tests?|node_modules)[/\\]|[.-](?:test|spec)\.[cm]?[jt]s$)/.test(
        file,
      )
    )
      continue;
    const text = fs.readFileSync(file, 'utf8');
    if (
      !text.includes('@nestjs/') &&
      !text.includes('NestFactory') &&
      slash(file) !== slash(sourceEntry ?? '')
    )
      continue;
    const name = slash(file);
    syntax.set(name, ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true));
  }
  const program = localProgram(root, syntax);
  const read = nestSource(program);
  function location(node) {
    const sf = node.getSourceFile();
    return {
      file: slash(path.relative(root, sf.fileName)),
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    };
  }
  function warn(node, message) {
    const { file, line } = location(node);
    warnings.add(file + ':' + line + ' ' + message);
  }
  const roots = [];
  const settings = [];
  const bootstrapFiles = sourceEntry
    ? [program.getSourceFile(slash(sourceEntry))].filter(Boolean)
    : [...syntax.values()];
  for (const sf of bootstrapFiles)
    walk(sf, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      const { expression, name } = node.expression;
      if (name.text === 'create' && read.imported(expression, '@nestjs/core') === 'NestFactory') {
        roots.push(node.arguments[0]);
      } else if (name.text === 'setGlobalPrefix' || name.text === 'enableVersioning')
        settings.push(node);
    });
  let globalPrefix = '';
  let exclusions = [];
  for (const call of settings) {
    if (call.expression.name.text === 'enableVersioning') {
      warn(call, '版本化路由可能需要运行时版本信息');
      continue;
    }
    const prefixes = read.strings(call.arguments[0]);
    if (prefixes.length === 1) globalPrefix = prefixes[0];
    else warn(call, '动态全局前缀无法解析，目录显示相对于该前缀的路径');
    exclusions = [];
    const options = read.value(call.arguments[1]);
    if (options && !ts.isObjectLiteralExpression(options))
      warn(options, '动态全局前缀排除规则无法解析');
    const exclude = read.member(options, 'exclude');
    if (exclude)
      for (const item of read.list(exclude, (n) => warn(n, '动态全局前缀排除列表无法展开'))) {
        const node = read.value(item);
        const isOptions = node && ts.isObjectLiteralExpression(node);
        const [pattern] = read.strings(isOptions ? read.member(node, 'path') : node);
        const method = isOptions ? read.member(node, 'method') : undefined;
        if (
          pattern === undefined ||
          (method &&
            (!ts.isPropertyAccessExpression(method) ||
              read.imported(method.expression, '@nestjs/common') !== 'RequestMethod'))
        ) {
          warn(item, '动态全局前缀排除项无法解析');
          continue;
        }
        try {
          exclusions.push({
            method: method?.name.text ?? 'ALL',
            pattern: pathToRegexp(routePath(pattern)),
          });
        } catch {
          warn(item, '无法解析全局前缀排除路径模板');
        }
      }
  }

  const modules = new Set();
  const controllerOwners = new Map();
  const mounts = new Map();
  const pending = [];
  function registerMounts(expr, parent = '', seen = new Set()) {
    const node = read.value(expr);
    if (!node || seen.has(node)) return;
    const trail = new Set([...seen, node]);
    for (const row of read.list(node, (n) => warn(n, '动态 RouterModule 路由表无法展开'))) {
      const item = read.value(row);
      if (item && ts.isClassDeclaration(item)) {
        mounts.set(item, parent);
        continue;
      }
      const subpath = read.strings(read.member(item, 'path'));
      if (subpath.length !== 1) {
        warn(row, '动态模块挂载路径无法解析');
        continue;
      }
      const prefix = routePath(parent, subpath[0]);
      const mounted = read.member(item, 'module');
      const cls = read.value(mounted);
      if (cls && ts.isClassDeclaration(cls)) mounts.set(cls, prefix);
      else if (mounted) warn(row, '动态挂载目标模块无法解析');
      const children = read.member(item, 'children');
      if (children) registerMounts(children, prefix, trail);
    }
  }
  function enqueue(expr, seen = new Set()) {
    const node = read.value(expr);
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (ts.isClassDeclaration(node)) {
      pending.push(node);
      return;
    }
    if (ts.isCallExpression(node)) {
      if (read.imported(node.expression, '@nestjs/common') === 'forwardRef') {
        const factory = node.arguments[0];
        if (factory && ts.isArrowFunction(factory) && !ts.isBlock(factory.body))
          return enqueue(factory.body, seen);
      }
      if (ts.isPropertyAccessExpression(node.expression)) {
        const target = node.expression.expression;
        if (
          read.imported(target, '@nestjs/core') === 'RouterModule' &&
          node.expression.name.text === 'register'
        ) {
          if (node.arguments[0]) registerMounts(node.arguments[0]);
          return;
        }
        const cls = read.value(target);
        if (cls && ts.isClassDeclaration(cls)) {
          const factory = read.declaration(node.expression);
          const results = factory?.body?.statements?.filter(ts.isReturnStatement) ?? [];
          const metadata = results.length === 1 && read.value(results[0].expression);
          if (metadata && ts.isObjectLiteralExpression(metadata)) {
            const selected = read.value(read.member(metadata, 'module'));
            const owner = selected && ts.isClassDeclaration(selected) ? selected : cls;
            pending.push(owner);
            registerMetadata(owner, metadata, seen);
          } else {
            pending.push(cls);
            warn(node, '动态模块返回值无法展开，仅分析类上静态声明的控制器和导入');
          }
          return;
        }
        // External framework integrations have no controller bodies inside src.
        if (externalImport(target)) return;
      }
    }
    if (!externalImport(node)) warn(expr, '动态模块导入无法解析');
  }
  function externalImport(node) {
    const binding = read.symbol(node)?.declarations?.find(ts.isImportSpecifier);
    if (!binding) return false;
    const spec = binding.parent.parent.parent.moduleSpecifier.text;
    return (
      !spec.startsWith('.') &&
      !spec.startsWith('@/') &&
      !read.declaration(node)?.getSourceFile().fileName
    );
  }
  if (roots.length) {
    for (const rootExpr of roots) enqueue(rootExpr);
  } else {
    warnings.add('未静态定位 NestFactory.create 入口，当前列出源码模块中显式注册的控制器');
    for (const sf of syntax.values())
      for (const stmt of sf.statements)
        if (ts.isClassDeclaration(stmt) && read.decorators(stmt).some((d) => d.name === 'Module'))
          pending.push(stmt);
  }
  for (let i = 0; i < pending.length; i++) {
    const cls = pending[i];
    if (modules.has(cls)) continue;
    modules.add(cls);
    const meta = read.decorators(cls).find((d) => d.name === 'Module')?.args[0];
    if (!meta) continue;
    registerMetadata(cls, meta);
  }
  function registerMetadata(cls, meta, seen = new Set()) {
    const obj = read.value(meta);
    if (!obj || !ts.isObjectLiteralExpression(obj) || obj.properties.some(ts.isSpreadAssignment))
      warn(meta, '动态模块元数据可能包含额外的控制器');
    const controllers = read.member(obj, 'controllers');
    if (controllers)
      for (const ctrl of read.list(controllers, (n) => warn(n, '动态控制器列表无法展开'))) {
        const target = read.value(ctrl);
        if (target && ts.isClassDeclaration(target)) {
          if (!controllerOwners.has(target)) controllerOwners.set(target, new Set());
          controllerOwners.get(target).add(cls);
        } else warn(ctrl, '动态控制器无法解析');
      }
    const imports = read.member(obj, 'imports');
    if (imports)
      for (const item of read.list(imports, (n) => warn(n, '动态模块导入列表无法展开')))
        enqueue(item, new Set(seen));
  }

  function paths(expr, options = false) {
    if (!expr) return [''];
    const obj = read.value(expr);
    if (options && obj && ts.isObjectLiteralExpression(obj)) return paths(read.member(obj, 'path'));
    const values = read.strings(expr);
    if (!values.length) warn(expr, '动态路由路径无法解析');
    return values;
  }
  for (const [ctrl, owners] of controllerOwners) {
    const chain = ancestry(ctrl, read);
    const annotation = chain
      .flatMap((cls) => read.decorators(cls))
      .find((d) => d.name === 'Controller');
    if (!annotation) {
      warn(ctrl, '已注册的控制器缺少可解析的 @Controller 声明');
      continue;
    }
    const bases = paths(annotation.args[0], true);
    const methodNames = new Set();
    for (const cls of chain)
      for (const fn of cls.members) {
        if (
          !ts.isMethodDeclaration(fn) ||
          !fn.body ||
          fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
        )
          continue;
        const name = fn.name.getText();
        if (methodNames.has(name)) continue;
        methodNames.add(name);
        for (const d of read.decorators(fn)) {
          let method = d.name.toUpperCase();
          let part = d.args[0];
          if (d.name === 'Sse') method = 'GET';
          else if (d.name === 'RequestMapping') {
            if (part && !ts.isObjectLiteralExpression(read.value(part) ?? part)) {
              warn(d.node, '动态 RequestMapping 声明无法解析');
              continue;
            }
            const verb = read.member(part, 'method');
            if (
              verb &&
              (!ts.isPropertyAccessExpression(verb) ||
                read.imported(verb.expression, '@nestjs/common') !== 'RequestMethod')
            ) {
              warn(d.node, '动态 RequestMapping 方法无法解析');
              continue;
            }
            method = verb?.name.text ?? 'GET';
            part = read.member(part, 'path');
          } else if (!verbs.has(d.name)) continue;
          for (const suffix of paths(part))
            for (const prefix of bases)
              for (const owner of owners) {
                const template = routePath(mounts.get(owner) ?? '', prefix, suffix);
                const excluded = exclusions.some(
                  (e) => (e.method === 'ALL' || e.method === method) && e.pattern.test(template),
                );
                const full = excluded ? template : routePath(globalPrefix, template);
                const id = method + ' ' + full;
                const entry = { id, method, path: full, ...location(d.node) };
                if (!catalog.has(id)) catalog.set(id, []);
                const group = catalog.get(id);
                if (group.some((r) => r.args[0] === fn)) continue;
                if (group.length) warn(fn, '同一方法和路径多次注册，已合并处理器');
                group.push({ entry, args: [fn], scope: new Map() });
              }
        }
      }
  }
  return { syntax, catalog, warnings, program };
}
