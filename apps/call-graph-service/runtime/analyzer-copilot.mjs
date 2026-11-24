import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript-compiler';
import { inProject } from './analyzer-source.mjs';

// Canonical paths accepted by @copilotkit/runtime 1.88.0 matchSegments and
// validateHttpMethod (multi-route mode). Feature checks run after routing.
const multiRoute = {
  GET: [
    '/info',
    '/inspector-metadata',
    '/inspector-learning',
    '/cpk-debug-events',
    '/threads',
    '/threads/:threadId/messages',
    '/threads/:threadId/events',
    '/threads/:threadId/state',
  ],
  POST: [
    '/transcribe',
    '/agent/:agentId/run',
    '/agent/:agentId/suggest',
    '/agent/:agentId/connect',
    '/agent/:agentId/stop/:threadId',
    '/trajectory/:trajectoryId/connect',
    '/threads/clear',
    '/threads/subscribe',
    '/threads/:threadId/archive',
    '/annotate',
  ],
  PATCH: ['/threads/:threadId'],
  DELETE: ['/threads/:threadId'],
};
const memoryRoutes = {
  GET: ['/memories'],
  POST: ['/memories', '/memories/recall', '/memories/subscribe'],
  PATCH: ['/memories/:memoryId'],
  DELETE: ['/memories/:memoryId'],
};

/** The project's Koa adapter owns these endpoints; SDK code stays outside the method graph. */
export function collectCopilot(root, syntax, catalog, warnings) {
  const slash = (file) => file.replaceAll('\\', '/');
  const bootstrap = syntax.get(slash(path.join(root, 'src/bootstrap/http.ts')));
  if (!bootstrap || !bootstrap.text.includes('agUiMiddleware()')) return;
  const file = 'src/ag-ui/index.ts';
  const filename = slash(path.join(root, file));
  if (!inProject(root, filename)) return;
  const sf = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  syntax.set(filename, sf);
  let middleware, handler, runtime;
  function visit(node) {
    if (ts.isFunctionExpression(node) && node.name?.text === 'agUiKoaMiddleware') middleware = node;
    if (ts.isCallExpression(node) && node.expression.getText(sf) === 'createCopilotRuntimeHandler')
      handler = node.arguments[0];
    if (ts.isNewExpression(node) && node.expression.getText(sf) === 'CopilotSseRuntime')
      runtime = node.arguments?.[0];
    ts.forEachChild(node, visit);
  }
  visit(sf);
  const value = (object, key) =>
    object?.properties?.find((p) => p.name?.getText(sf) === key)?.initializer;
  const expr = value(handler, 'basePath');
  let basePath = expr && ts.isStringLiteralLike(expr) && expr.text;
  // Resolve the project's imported constant instead of duplicating its URL.
  if (expr && ts.isIdentifier(expr)) {
    for (const declaration of sf.statements) {
      if (!ts.isImportDeclaration(declaration)) continue;
      const binding = declaration.importClause?.namedBindings?.elements?.find(
        (item) => item.name.text === expr.text,
      );
      if (!binding) continue;
      const imported = ts.resolveModuleName(
        declaration.moduleSpecifier.text,
        filename,
        { moduleResolution: ts.ModuleResolutionKind.NodeNext },
        ts.sys,
      ).resolvedModule;
      if (!imported || !inProject(root, imported.resolvedFileName)) break;
      const constants = ts.createSourceFile(
        imported.resolvedFileName,
        fs.readFileSync(imported.resolvedFileName, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const stmt of constants.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        const name = binding.propertyName?.text ?? binding.name.text;
        const init = stmt.declarationList.declarations.find(
          (d) => d.name.getText(constants) === name,
        )?.initializer;
        if (init && ts.isStringLiteralLike(init)) basePath = init.text;
      }
    }
  }
  if (!basePath || !middleware) {
    warnings.add('无法解析 AG-UI 的中间件或 HTTP 挂载前缀');
    return;
  }
  const line = sf.getLineAndCharacterOfPosition(middleware.getStart(sf)).line + 1;
  function add(method, suffix) {
    const full = basePath.replace(/\/$/, '') + suffix;
    const entry = { id: method + ' ' + full, method, path: full, file, line };
    const registration = { entry, suffix, scope: new Map(), args: [middleware] };
    if (!catalog.has(entry.id)) catalog.set(entry.id, []);
    catalog.get(entry.id).push(registration);
  }
  let version;
  try {
    version = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules/@copilotkit/runtime/package.json'), 'utf8'),
    ).version;
  } catch {
    /* Node dependencies may not be installed on a scan-only host. */
  }
  const mode = value(handler, 'mode');
  const memory = value(runtime, 'exposeMemoryRoutes');
  const dynamic =
    !runtime ||
    !ts.isObjectLiteralExpression(runtime) ||
    runtime.properties.some(ts.isSpreadAssignment) ||
    handler.properties.some(ts.isSpreadAssignment) ||
    (memory && ![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(memory.kind));
  if (version !== '1.88.0' || dynamic || (mode && mode.text !== 'multi-route')) {
    warnings.add('AG-UI 的运行时版本或路由配置未适配，已列出可追踪的中间件前缀。');
    add('ALL', '/:path(.*)');
  } else {
    const tables = [multiRoute];
    if (value(runtime, 'memory') || memory?.kind === ts.SyntaxKind.TrueKeyword)
      tables.push(memoryRoutes);
    for (const table of tables)
      for (const [method, paths] of Object.entries(table))
        for (const suffix of paths) add(method, suffix);
  }
}
