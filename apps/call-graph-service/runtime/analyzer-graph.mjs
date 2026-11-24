import path from 'node:path';
import ts from 'typescript-compiler';
import { inProject, unwrapped } from './analyzer-source.mjs';
import { functionMetadata } from './function-metadata.mjs';
import {
  compilerLibrary,
  markComputations,
  requiresRuntime,
  returnsDeferredValue,
  synchronousBuiltin,
} from './analyzer-computation.mjs';

const MAX_NODES = 1200;
const MAX_EDGES = 4800;
const slash = (file) => file.replaceAll('\\', '/');

export function localProgram(root, syntax) {
  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ESNext,
    allowJs: true,
    lib: ['lib.es2023.d.ts'],
    types: [],
    noEmit: true,
  };
  const read = (file) =>
    compilerLibrary(file) || inProject(root, file) ? ts.sys.readFile(file) : undefined;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), read);
  if (config.config?.compilerOptions) {
    const configured = ts.convertCompilerOptionsFromJson(
      config.config.compilerOptions,
      root,
    ).options;
    Object.assign(options, { paths: configured.paths, baseUrl: configured.baseUrl ?? root });
  }
  // Use bundled intrinsic signatures and project types. External package sources
  // and SDK declarations can be much larger and have no traceable project bodies.
  const host = ts.createCompilerHost(options, true);
  host.readFile = read;
  const originalRead = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) => {
    if (compilerLibrary(file)) return originalRead(file, ...args);
    const relative = slash(path.relative(root, file));
    if (
      relative === '..' ||
      relative.startsWith('../') ||
      path.isAbsolute(relative) ||
      relative.split('/').includes('node_modules') ||
      !inProject(root, file)
    )
      return;
    return syntax.get(slash(file)) ?? originalRead(file, ...args);
  };
  return ts.createProgram([...syntax.keys()], options, host);
}

function executable(node) {
  return (
    node?.body &&
    !node.asteriskToken &&
    (ts.isArrowFunction(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node))
  );
}

/** Resolve executable declarations and expand only the work reachable from the selected handler. */
export function graphBuilder(root, syntax, catalog, program = localProgram(root, syntax)) {
  const checker = program.getTypeChecker();
  function declaration(expr) {
    let symbol = checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(expr) ? expr.name : expr,
    );
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return (
      symbol?.declarations?.find(executable) ??
      symbol?.valueDeclaration ??
      symbol?.declarations?.[0]
    );
  }
  function resolve(expr, bindings, seen = new Set()) {
    const node = unwrapped(expr);
    if (!node || seen.has(node) || seen.size > 30) return;
    seen.add(node);
    if (executable(node)) return node;
    if (ts.isSpreadElement(node)) return resolve(node.expression, bindings, seen);
    const decl = declaration(node);
    if (!decl) return;
    if (executable(decl)) return decl;
    if (bindings.has(decl)) return resolve(bindings.get(decl), bindings, seen);
    return resolve(decl.initializer, bindings, seen);
  }
  function callee(call, bindings) {
    const direct = resolve(call.expression, bindings);
    if (direct) return direct;
    const result = checker.getResolvedSignature(call)?.getDeclaration();
    return executable(result) ? result : undefined;
  }
  function returned(fn) {
    if (!ts.isBlock(fn.body)) return [fn.body];
    const values = [];
    function visit(node) {
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) values.push(node.expression);
      else ts.forEachChild(node, visit);
    }
    visit(fn.body);
    return values;
  }
  return (registrations, rootsOnly = false) => {
    const nodes = new Map();
    const roots = new Set();
    const edges = new Map();
    const warnings = new Set();
    const queue = [];
    const expanded = new Set();
    const blocked = new Set();
    let truncated = false;
    function add(fn, parent, bindings) {
      const sf = fn.getSourceFile();
      const file = slash(path.relative(root, sf.fileName));
      const pos = fn.getStart(sf);
      const id = file + ':' + pos;
      if (rootsOnly) {
        roots.add(id);
        return;
      }
      if (!nodes.has(id)) {
        if (nodes.size >= MAX_NODES) {
          truncated = true;
          warnings.add('静态图达到 ' + MAX_NODES + ' 个方法上限');
          return;
        }
        const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
        const { name, anonymous } = functionMetadata(fn, sf, line);
        nodes.set(id, { id, file, name, anonymous, line });
      }
      // The same helper may receive different callbacks on different paths.
      // Only retain bindings belonging to this function or an enclosing closure.
      const closure = new Map();
      const contextKey = [id];
      for (let scope = fn; scope; scope = scope.parent) {
        if (!ts.isFunctionLike(scope)) continue;
        for (const param of scope.parameters) {
          const callback = bindings.has(param) && resolve(bindings.get(param), bindings);
          if (callback) {
            closure.set(param, callback);
            contextKey.push(
              param.getStart() +
                '=' +
                callback.getSourceFile().fileName +
                ':' +
                callback.getStart(),
            );
          }
        }
      }
      const key = contextKey.join('|');
      if (!expanded.has(key)) {
        if (expanded.size < MAX_NODES * 8) {
          expanded.add(key);
          queue.push({ fn, id, bindings: closure });
        } else {
          truncated = true;
          warnings.add('静态图达到回调组合展开上限');
        }
      }
      if (!parent) roots.add(id);
      else if (edges.size < MAX_EDGES) edges.set(parent + '\n' + id, { from: parent, to: id });
      else {
        truncated = true;
        warnings.add('静态图达到 ' + MAX_EDGES + ' 条调用关系上限');
      }
    }
    function callBindings(fn, args, inherited) {
      const mapped = new Map(inherited);
      fn.parameters.forEach((p, i) => {
        mapped.delete(p);
        const callback = args[i] && resolve(args[i], inherited);
        if (callback) mapped.set(p, callback);
      });
      return mapped;
    }
    function handler(arg, bindings, seen = new Set()) {
      const node = unwrapped(arg);
      if (!node || seen.has(node)) return false;
      const trail = new Set([...seen, node]);
      if (ts.isArrayLiteralExpression(node))
        return node.elements.map((item) => handler(item, bindings, trail)).every(Boolean);
      if (ts.isCallExpression(node)) {
        const factory = callee(node, bindings);
        if (!factory) return false;
        const inner = callBindings(factory, node.arguments, bindings);
        let found = false;
        for (const value of returned(factory)) {
          if (handler(value, inner, trail)) found = true;
        }
        return found;
      }
      const fn = resolve(node, bindings);
      if (fn) {
        add(fn, null, bindings);
        return true;
      }
      const decl = declaration(node);
      return decl?.initializer ? handler(decl.initializer, bindings, trail) : false;
    }
    function collectRoots(reg, inherited = new Set()) {
      if (inherited.has(reg)) return;
      const next = new Set([...inherited, reg]);
      const bindings = new Map();
      // A locally invoked registration helper closes over that route's callbacks.
      for (const arg of reg.args) {
        for (let p = arg.parent; p; p = p.parent) {
          if (!ts.isFunctionLike(p)) continue;
          for (const param of p.parameters) {
            const value = reg.scope.get(param.name.getText());
            if (value) bindings.set(param, value);
          }
        }
      }
      let reused = false;
      if (reg.stackReference) {
        const file = declaration(reg.stackReference)?.getSourceFile().fileName;
        const remote = file && slash(path.relative(root, file));
        for (const group of catalog.values())
          for (const item of group) {
            if (
              item.entry.file === remote &&
              item.entry.method === reg.entry.method &&
              item.suffix === reg.suffix
            ) {
              reused = true;
              collectRoots(item, next);
            }
          }
        if (!reused) warnings.add('未能解析复用路由栈的所有处理器');
      }
      for (const arg of reg.args) {
        if (handler(arg, bindings)) continue;
        const target = ts.isSpreadElement(arg) ? arg.expression : arg;
        if (reused && ts.isIdentifier(target) && ts.isBindingElement(declaration(target) ?? target))
          continue;
        warnings.add('无法静态展开中间件 ' + arg.getText().split('\n')[0].slice(0, 90));
      }
    }
    for (const reg of registrations) collectRoots(reg);
    if (rootsOnly) return [...roots];
    for (let i = 0; i < queue.length; i++) {
      const { fn, id, bindings } = queue[i];
      if (
        fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ||
        ts.isFunctionLike(fn.body)
      )
        blocked.add(id);
      function visit(node) {
        // Uninvoked nested functions do not form edges. Call arguments below
        // account for callbacks potentially executed by project or external APIs.
        if (ts.isFunctionLike(node)) {
          if (ts.isReturnStatement(node.parent)) blocked.add(id);
          return;
        }
        if (!blocked.has(id) && requiresRuntime(node, checker)) blocked.add(id);
        if (ts.isCallExpression(node)) {
          const child = callee(node, bindings);
          if (!blocked.has(id)) {
            const decl = declaration(node.expression);
            const dynamic =
              ts.isElementAccessExpression(node.expression) ||
              ts.isCallExpression(node.expression) ||
              (decl &&
                (ts.isParameter(decl) ||
                  (ts.isVariableDeclaration(decl) &&
                    !(decl.parent.flags & ts.NodeFlags.Const) &&
                    !compilerLibrary(decl.getSourceFile().fileName))));
            if (
              dynamic ||
              (!child && !synchronousBuiltin(node, checker, (arg) => !!resolve(arg, bindings)))
            )
              blocked.add(id);
          }
          if (child) add(child, id, callBindings(child, node.arguments, bindings));
          else
            for (const arg of node.arguments) {
              const callback = resolve(arg, bindings);
              if (callback) add(callback, id, bindings);
            }
        }
        ts.forEachChild(node, visit);
      }
      if (ts.isFunctionLike(fn.body)) continue;
      for (const p of fn.parameters) visit(p);
      if (fn.type) visit(fn.type);
      visit(fn.body);
      if (!blocked.has(id) && returnsDeferredValue(fn, checker)) blocked.add(id);
    }
    if (!truncated) markComputations(nodes, edges, blocked);
    return {
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      roots: [...roots],
      warnings: [...warnings],
    };
  };
}
