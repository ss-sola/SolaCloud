import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-compiler';
import { functionMetadata } from './function-metadata.mjs';

const ignored = /^(?:node_modules|\.pnpm|\.yarn|\.git|dist|build|coverage|vendor)$/i;
const extension = /\.(?:[mc]?[jt]s)$/i;
const runtime = 'globalThis[Symbol.for("solacloud.api-call-graph")]';

/** 当原方法用 var 重声明形参时，把相同绑定传给新的函数体作用域。 */
function redeclaredParameters(body, parameters) {
  const declared = new Set();
  function gather(node) {
    if (ts.isFunctionLike(node)) return;
    if (ts.isVariableDeclarationList(node) && !(node.flags & ts.NodeFlags.BlockScoped)) {
      function add(binding) {
        if (ts.isIdentifier(binding)) declared.add(binding.text);
        else for (const element of binding.elements) if (element.name) add(element.name);
      }
      for (const declaration of node.declarations) add(declaration.name);
    }
    ts.forEachChild(node, gather);
  }
  gather(body);
  const names = [];
  function select(binding) {
    if (ts.isIdentifier(binding)) {
      if (declared.has(binding.text) && !names.includes(binding.text)) names.push(binding.text);
    } else for (const element of binding.elements) if (element.name) select(element.name);
  }
  for (const parameter of parameters) select(parameter.name);
  return names.join(',');
}

/** 用路径分段界定目录，支持 Windows 跨盘符和相似前缀。 */
export function within(root, file) {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

export function methodMetadata(node, ast, filename) {
  const start = node.getStart(ast);
  const { line } = ast.getLineAndCharacterOfPosition(start);
  const parameters = node.parameters.filter((p) => p.name.getText(ast) !== 'this');
  return {
    ...functionMetadata(node, ast, line + 1),
    id: filename + ':' + start,
    file: filename,
    line: line + 1,
    params: parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null)),
    rest: !!parameters.at(-1)?.dotDotDotToken,
  };
}

export function observable(node) {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)) &&
    node.body &&
    !node.asteriskToken
  );
}

/** 从实际源码位置提取方法元数据，仅在内存中加入调用观察。 */
export function instrument(source, filename, metadata = methodMetadata) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  function visit(node) {
    if (observable(node)) {
      const start = node.getStart(ast);
      const info = metadata(node, ast, filename);
      if (!info) return ts.forEachChild(node, visit);
      const meta = JSON.stringify(info);
      if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        edits.push([start, runtime + '.observe(' + meta + ',']);
        ts.forEachChild(node, visit);
        edits.push([node.end, ')']);
        return;
      }
      const statements = node.body.statements;
      let insertion = node.body.getStart(ast) + 1;
      for (const statement of statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression))
          break;
        insertion = statement.end;
      }
      const asyncBody = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      const locals = redeclaredParameters(node.body, node.parameters);
      edits.push([
        insertion,
        ';return ' +
          runtime +
          '.invoke(' +
          meta +
          ',arguments,' +
          (asyncBody ? 'async ' : '') +
          '(' +
          locals +
          ')=>{',
      ]);
      ts.forEachChild(node, visit);
      edits.push([node.body.end - 1, '\n}' + (locals ? ',[' + locals + ']' : '') + ');']);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  // 同一位置可能同时闭合多个表达式，保持从内到外的遍历顺序。
  edits.sort((a, b) => a[0] - b[0]);
  let result = '',
    offset = 0;
  for (const [at, addition] of edits) {
    result += source.slice(offset, at) + addition;
    offset = at;
  }
  return result + source.slice(offset);
}

/** 仅在目标源码加载时转换；包导入及其内部依赖沿用原始加载流程。 */
export function installSourceHook(project, sourceRoot) {
  const dependencies = new Set();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      const bare = !/^(?:[.#/]|[a-z][a-z\d+.-]*:)/i.test(specifier) && !path.isAbsolute(specifier);
      if (result.url.startsWith('file:') && (bare || dependencies.has(context.parentURL))) {
        dependencies.add(result.url);
      }
      return result;
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (!url.startsWith('file:') || dependencies.has(url)) return loaded;
      const file = fileURLToPath(url);
      if (!extension.test(file) || !within(sourceRoot, file)) return loaded;
      const actual = realpathSync(file);
      if (
        !within(sourceRoot, actual) ||
        [file, actual].some((f) =>
          path
            .relative(project, f)
            .split(path.sep)
            .some((part) => ignored.test(part)),
        )
      )
        return loaded;
      const source = loaded.source ?? readFileSync(actual);
      return {
        ...loaded,
        source: instrument(
          Buffer.from(source).toString('utf8'),
          path.relative(project, actual).split(path.sep).join('/'),
        ),
      };
    },
  });
}
