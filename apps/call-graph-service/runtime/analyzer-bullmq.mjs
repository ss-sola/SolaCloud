import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript-compiler';
import { inProject, unwrapped } from './analyzer-source.mjs';

const extensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];
const testScript =
  /(?:^|[:_-])(?:test|lint|build|bench|coverage|check|typecheck|format)(?:$|[:_-])/i;
const workerScript =
  /(?:^|[:_-])(?:workers?|consumers?|processors?|queue|jobs?|background)(?:$|[:_-])/i;

export function nodeScriptEntry(script) {
  if (typeof script !== 'string') return;
  // The probe uses its own bootstrap. Read the declared file without running a shell or preloads.
  const match =
    /^\s*node\s+(?:--enable-source-maps\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))\s*$/.exec(script);
  return match?.slice(1).find(Boolean);
}

function scriptEntry(scripts, name) {
  const visited = new Set();
  while (name && !visited.has(name)) {
    visited.add(name);
    if (!Object.hasOwn(scripts, name) || testScript.test(name)) return;
    const script = scripts[name];
    const entry = nodeScriptEntry(script);
    if (entry) return entry;
    name =
      typeof script === 'string' &&
      /^\s*(?:npm|pnpm|yarn|bun)\s+run\s+([\w:.-]+)\s*$/.exec(script)?.[1];
  }
}

function readSyntax(root) {
  const cache = new Map();

  function localFile(file) {
    const relative = path.relative(root, file);
    if (
      path.isAbsolute(relative) ||
      relative
        .split(path.sep)
        .some((component) => component === '..' || component === 'node_modules') ||
      !inProject(root, file) ||
      !fs.statSync(file, { throwIfNoEntry: false })?.isFile()
    )
      return;
    const real = fs.realpathSync(file);
    if (path.relative(root, real).split(path.sep).includes('node_modules')) return;
    return real;
  }

  function resolveImport(file, specifier) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return;
    const base = path.resolve(path.dirname(file), specifier);
    const tryFiles = path.extname(base)
      ? [
          base,
          base.replace(/\.js$/, '.ts'),
          base.replace(/\.mjs$/, '.mts'),
          base.replace(/\.cjs$/, '.cts'),
        ]
      : [
          ...extensions.map((ext) => base + ext),
          ...extensions.map((ext) => path.join(base, 'index' + ext)),
        ];
    for (const candidate of new Set(tryFiles)) {
      if (!extensions.includes(path.extname(candidate).toLowerCase())) continue;
      const resolved = localFile(candidate);
      if (resolved) return resolved;
    }
  }

  function inspect(file) {
    if (cache.has(file)) return cache.get(file);
    const dependencies = new Set();
    const bindings = new Map();
    const constructs = [];
    const calls = [];
    const facts = { dependencies, worker: false, processor: false, http: false, context: false };
    cache.set(file, facts);
    let source;
    try {
      source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
    } catch {
      return facts;
    }

    function addBinding(node, mod) {
      if (ts.isIdentifier(node)) bindings.set(node.text, mod);
      else if (ts.isObjectBindingPattern(node)) {
        for (const { name, propertyName } of node.elements)
          if (ts.isIdentifier(name))
            bindings.set(name.text, mod + '#' + (propertyName ?? name).text);
      }
    }
    function moduleCall(node) {
      if (!ts.isCallExpression(node) || !ts.isStringLiteralLike(node.arguments[0] ?? node)) return;
      if (
        (ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      )
        return node.arguments[0].text;
    }
    function reference(expression) {
      const node = unwrapped(expression);
      if (ts.isIdentifier(node)) return bindings.get(node.text);
      if (ts.isPropertyAccessExpression(node)) {
        const owner = reference(node.expression);
        return owner && owner + '#' + node.name.text;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken)
        return reference(node.right);
      return moduleCall(node);
    }
    function recordModule(mod) {
      const resolved = resolveImport(file, mod);
      if (resolved) dependencies.add(resolved);
    }
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const mod = node.moduleSpecifier.text;
        const clause = ts.isImportDeclaration(node) && node.importClause;
        const named = clause && clause.namedBindings;
        const typeOnly =
          clause &&
          (clause.isTypeOnly ||
            (!clause.name &&
              named &&
              ts.isNamedImports(named) &&
              named.elements.length > 0 &&
              named.elements.every((item) => item.isTypeOnly)));
        if (!typeOnly) {
          recordModule(mod);
          if (clause) {
            if (clause.name) addBinding(clause.name, mod);
            if (named && ts.isNamespaceImport(named)) addBinding(named.name, mod);
            if (named && ts.isNamedImports(named))
              for (const item of named.elements)
                if (!item.isTypeOnly)
                  addBinding(item.name, mod + '#' + (item.propertyName ?? item.name).text);
          }
        }
      } else if (ts.isCallExpression(node)) {
        const mod = moduleCall(node);
        if (mod) recordModule(mod);
        else calls.push(node.expression);
      } else if (ts.isVariableDeclaration(node) && node.initializer) {
        const imported = reference(node.initializer);
        if (imported) addBinding(node.name, imported);
      } else if (ts.isNewExpression(node)) constructs.push(node.expression);
      ts.forEachChild(node, visit);
    }
    visit(source);
    facts.worker = constructs.some((expression) => reference(expression) === 'bullmq#Worker');
    for (const expression of calls) {
      const ref = reference(expression);
      if (ref === '@nestjs/bullmq#Processor') facts.processor = true;
      if (ref === '@nestjs/core#NestFactory#createApplicationContext') facts.context = true;
      if (
        ref === '@nestjs/core#NestFactory#create' ||
        (ts.isPropertyAccessExpression(expression) && expression.name.text === 'listen')
      )
        facts.http = true;
    }
    return facts;
  }

  function inspectTree(entry) {
    const sites = new Set();
    const files = new Set();
    let http = false;
    let context = false;
    const processors = [];
    const pending = entry ? [entry] : [];
    while (pending.length) {
      const file = pending.pop();
      if (files.has(file)) continue;
      files.add(file);
      const facts = inspect(file);
      if (facts.worker) sites.add(file);
      if (facts.processor) processors.push(file);
      http ||= facts.http;
      context ||= facts.context;
      for (const dependency of facts.dependencies) pending.push(dependency);
    }
    if (context || http) for (const file of processors) sites.add(file);
    return { sites, http, files };
  }
  return { inspectTree, localFile };
}

/** 启动入口由项目脚本声明，Worker 身份由入口可达的源码注册确认。 */
export function discoverWorkerEntries({ root, entry, framework, scripts = {} }) {
  scripts ??= {};
  const { inspectTree, localFile } = readSyntax(root);
  const candidates = new Map();
  const warnings = [];
  for (const name of Object.keys(scripts)) {
    if (testScript.test(name)) continue;
    const declared = scriptEntry(scripts, name);
    const extension = declared && path.extname(declared).toLowerCase();
    const supported =
      extensions.includes(extension) && (framework !== 'nestjs' || /\.[cm]?js$/.test(extension));
    const file = supported && localFile(path.resolve(root, declared));
    if (file) candidates.set(file, candidates.get(file) ?? name);
    else if (workerScript.test(name))
      warnings.push('无法从项目脚本 ' + name + ' 确认可直接启动的 BullMQ Worker 入口。');
  }
  if (!candidates.size) return { workerEntries: [], warnings };
  const main = entry && localFile(path.resolve(root, entry));
  const http = inspectTree(main);
  const matched = new Map();
  for (const [file, script] of candidates) {
    if (http.files.has(file)) continue;
    const candidate = inspectTree(file);
    if (candidate.http || [...candidate.sites].some((site) => http.sites.has(site))) continue;
    if (!candidate.sites.size) {
      if (workerScript.test(script))
        warnings.push('未能在项目脚本 ' + script + ' 的入口确认 BullMQ Worker 注册。');
      continue;
    }
    matched.set(file, candidate.files);
  }
  // A launcher that runs another declared entry already covers its Worker.
  // If launchers import each other, keep the first one in manifest order.
  const workers = [...matched];
  const workerEntries = workers
    .filter(
      ([file, files], index) =>
        !workers.some(
          ([other, imported], position) =>
            other !== file && imported.has(file) && (!files.has(other) || position < index),
        ),
    )
    .map(([file]) => path.relative(root, file).split(path.sep).join('/'));
  return { workerEntries, warnings };
}
