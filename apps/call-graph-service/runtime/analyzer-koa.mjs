import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript-compiler';
import { collectCopilot } from './analyzer-copilot.mjs';
import { inProject, skippedDirs, unwrapped } from './analyzer-source.mjs';
const verbs = new Set([
  'get',
  'post',
  'put',
  'patch',
  'del',
  'delete',
  'options',
  'head',
  'all',
  'register',
]);
const slash = (name) => name.replaceAll('\\', '/');

function strings(expression, values) {
  const node = unwrapped(expression);
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node))
    return node.elements.flatMap((item) => strings(item, values));
  if (ts.isIdentifier(node) && values.has(node.text))
    return strings(values.get(node.text), new Map());
  return [];
}

function walk(node, visit) {
  if (visit(node) !== false)
    ts.forEachChild(node, (child) => {
      walk(child, visit);
    });
}

function declarations(node) {
  return ts.isVariableStatement(node) ? node.declarationList.declarations : [];
}

function routePath(...parts) {
  const combined = parts
    .filter(Boolean)
    .join('/')
    .replace(/\/{2,}/g, '/');
  return combined.replace(/\/$/, '') || '/';
}

export function hasRootRouterLoader(root, source) {
  const loader = path.join(source, 'controller', 'index.ts');
  return (
    inProject(root, loader) && fs.readFileSync(loader, 'utf8').includes('class RootRouterLoader')
  );
}

/**
 * Read Koa declarations as data. The target application's imports, config loaders
 * and bootstrap code must never run during discovery.
 */
export function collectKoaRoutes({ root, source, sourceFiles }) {
  const loader = path.join(source, 'controller', 'index.ts');
  const autoMount = hasRootRouterLoader(root, source);
  let files;
  if (autoMount) {
    const controller = path.dirname(loader);
    const domains = fs
      .readdirSync(controller, { withFileTypes: true })
      .filter(
        (item) =>
          item.isDirectory() &&
          !skippedDirs.has(item.name) &&
          !['validator', 'router-handler'].includes(item.name),
      );
    files = domains.flatMap(({ name }) =>
      sourceFiles(path.join(controller, name))
        .filter(
          (file) => file.endsWith('.ts') && file !== slash(path.join(controller, name, 'index.ts')),
        )
        .map((file) => [file, '/' + name]),
    );
    const bootstrap = slash(path.join(source, 'bootstrap/http.ts'));
    if (inProject(root, bootstrap)) files.push([bootstrap, '']);
  } else {
    files = sourceFiles(source).map((file) => [file, '']);
  }
  const catalog = new Map();
  const warnings = new Set();
  const syntax = new Map();
  for (const [file, mount] of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('@koa/router') && !text.includes('koa-router') && !(autoMount && !mount))
      continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    syntax.set(file, sf);
    const relative = slash(path.relative(root, file));
    const location = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const warn = (node, reason) => warnings.add(relative + ':' + location(node) + ' ' + reason);
    const constructors = new Set();
    const routers = new Map();
    const helpers = new Map();
    const used = new Map();
    for (const stmt of sf.statements) {
      if (
        ts.isImportDeclaration(stmt) &&
        ['@koa/router', 'koa-router'].includes(stmt.moduleSpecifier.text) &&
        stmt.importClause?.name
      )
        constructors.add(stmt.importClause.name.text);
      if (ts.isFunctionDeclaration(stmt) && stmt.name) helpers.set(stmt.name.text, stmt);
      for (const decl of declarations(stmt)) {
        if (
          ts.isNewExpression(decl.initializer ?? stmt) &&
          constructors.has(decl.initializer.expression.getText(sf))
        ) {
          const opts = decl.initializer.arguments?.[0];
          const prop =
            opts &&
            ts.isObjectLiteralExpression(opts) &&
            opts.properties.find((p) => p.name?.getText(sf) === 'prefix');
          const prefix = prop ? strings(prop.initializer, new Map())[0] : '';
          if (prefix === undefined) warn(decl, '动态路由前缀无法解析');
          else routers.set(decl.name.getText(sf), prefix);
        }
      }
    }
    // The WZJ bootstrap obtains its root router from a loader getter.
    if (autoMount && !mount) routers.set('rootRouter', '');
    function record(call, scope, origin, stackReference) {
      if (!ts.isPropertyAccessExpression(call.expression)) return;
      const receiver = call.expression.expression.getText(sf);
      if (!routers.has(receiver)) return;
      const method = call.expression.name.text;
      const args = call.arguments;
      if (method === 'use') {
        if (
          !args.some(
            (arg) => ts.isCallExpression(arg) && arg.expression.getText(sf).endsWith('.routes'),
          )
        ) {
          if (!used.has(receiver)) used.set(receiver, []);
          used.get(receiver).push(...args);
        }
        return;
      }
      if (!verbs.has(method)) return;
      // rootRouter.all in this bootstrap installs auth middleware on route groups.
      if (autoMount && !mount && method === 'all') return;
      const paths = strings(args[0], scope);
      const methods =
        method === 'register'
          ? strings(args[1], scope)
          : [method === 'del' ? 'DELETE' : method.toUpperCase()];
      if (!paths.length || !methods.length) {
        warn(call, '动态路由声明无法展开');
        return;
      }
      const handlers =
        method === 'register' && args[2] && ts.isArrayLiteralExpression(args[2])
          ? [...args[2].elements]
          : args.slice(1);
      for (const suffix of paths)
        for (const verb of methods) {
          const full = routePath(mount, routers.get(receiver), suffix);
          const id = verb + ' ' + full;
          const entry = { id, method: verb, path: full, file: relative, line: location(origin) };
          const registration = {
            entry,
            scope,
            suffix,
            stackReference,
            args: [...(used.get(receiver) ?? []), ...handlers],
          };
          if (catalog.has(id)) warn(origin, '同一方法和路径多次注册，已合并处理器');
          if (!catalog.has(id)) catalog.set(id, []);
          catalog.get(id).push(registration);
        }
    }
    function collect(node, scope = new Map(), origin, stackReference, expanding = new Set()) {
      if (ts.isFunctionLike(node)) return;
      if (ts.isForOfStatement(node)) {
        const iter = unwrapped(node.expression);
        const binding = node.initializer.declarations?.[0]?.name;
        if (ts.isArrayLiteralExpression(iter) && binding && ts.isArrayBindingPattern(binding)) {
          // A table can reuse middleware from another router's stack.find().
          let importedRouter;
          walk(node.statement, (item) => {
            if (
              ts.isCallExpression(item) &&
              ts.isPropertyAccessExpression(item.expression) &&
              item.expression.name.text === 'find'
            ) {
              const stack = item.expression.expression;
              if (ts.isPropertyAccessExpression(stack) && stack.name.text === 'stack')
                importedRouter = stack.expression;
            }
          });
          for (const row of iter.elements) {
            if (!ts.isArrayLiteralExpression(row)) continue;
            const values = new Map(scope);
            binding.elements.forEach((part, i) => {
              if (part.name && row.elements[i]) values.set(part.name.getText(sf), row.elements[i]);
            });
            collect(node.statement, values, row, importedRouter, expanding);
          }
          return;
        }
      }
      if (ts.isCallExpression(node)) {
        record(node, scope, origin ?? node, stackReference);
        const helper = ts.isIdentifier(node.expression) && helpers.get(node.expression.text);
        if (helper?.body && !expanding.has(helper)) {
          const values = new Map(scope);
          helper.parameters.forEach((p, i) => {
            if (node.arguments[i]) values.set(p.name.getText(sf), node.arguments[i]);
          });
          collect(
            helper.body,
            values,
            origin ?? node,
            stackReference,
            new Set([...expanding, helper]),
          );
        }
        return;
      }
      ts.forEachChild(node, (child) => {
        collect(child, scope, origin, stackReference, expanding);
      });
    }
    if (autoMount && !mount) {
      walk(sf, (node) => {
        if (ts.isCallExpression(node)) record(node, new Map(), node);
      });
    } else collect(sf);
  }
  if (autoMount) collectCopilot(root, syntax, catalog, warnings);
  if (!catalog.size) warnings.add('没有发现受支持的 Koa HTTP 路由声明。');
  return { catalog, syntax, warnings };
}
