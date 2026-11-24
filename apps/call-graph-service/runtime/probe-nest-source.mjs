import { readFileSync, realpathSync, statSync } from 'node:fs';
import { registerHooks, SourceMap } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript-compiler';
import { instrument, methodMetadata, observable, within } from './probe-source.mjs';

const ignored = /^(?:node_modules|\.pnpm|\.git|vendor|coverage)$/i;
const slash = (value) => value.split(path.sep).join('/');
const normalized = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

function projectFile(root, file) {
  const allowed = (name) =>
    within(root, name) &&
    !path
      .relative(root, name)
      .split(path.sep)
      .some((part) => ignored.test(part));
  if (!allowed(file)) return;
  const actual = realpathSync(file);
  if (allowed(actual)) return actual;
}

// Resolve each local URL against the map location, including split map/source roots.
function localFile(reference, base) {
  if (path.isAbsolute(reference)) return path.normalize(reference);
  const url = new URL(reference.replaceAll('\\', '/'), base);
  if (url.protocol === 'file:' && (!url.host || url.host === 'localhost'))
    return fileURLToPath(url);
}

function mapFor(root, file, source) {
  const directive =
    /(?:^|\n)[ \t]*(?:\/\/[#@][ \t]*sourceMappingURL=([^\s]+)|\/\*[#@][ \t]*sourceMappingURL=([^\s*]+)[ \t]*\*\/)[ \t\r]*(?=\n|$)/g;
  let location;
  for (const match of source.matchAll(directive)) location = match[1] || match[2];
  if (!location) return;
  let payload,
    mapFile = file;
  if (location.startsWith('data:')) {
    const data = /^data:application\/json((?:;[^,]*)?),(.*)$/i.exec(location);
    if (!data) return;
    payload = JSON.parse(
      /;base64(?:;|$)/i.test(data[1])
        ? Buffer.from(data[2], 'base64').toString('utf8')
        : decodeURIComponent(data[2]),
    );
  } else {
    const local = localFile(location, pathToFileURL(file));
    if (!local || !(mapFile = projectFile(root, local))) return;
    payload = JSON.parse(readFileSync(mapFile, 'utf8'));
  }
  if (
    payload.version !== 3 ||
    !Array.isArray(payload.sources) ||
    typeof payload.mappings !== 'string'
  )
    return;
  if (payload.file && path.basename(payload.file.replaceAll('\\', '/')) !== path.basename(file))
    return;
  return { payload, mapFile, map: new SourceMap(payload) };
}

function anchors(node, ast) {
  return new Set(
    [
      node.getStart(ast),
      node.name?.getStart(ast),
      node.equalsGreaterThanToken?.getStart(ast),
      node.body.getStart(ast),
    ].filter((n) => n !== undefined),
  );
}

function sourceIndex(file, text, root) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const starts = ast.getLineStarts();
  const filename = slash(path.relative(root, file));
  const entries = new Map();
  function visit(node) {
    if (observable(node)) {
      const info = methodMetadata(node, ast, filename);
      const candidate = { node, info };
      for (const offset of anchors(node, ast)) {
        if (!entries.has(offset)) entries.set(offset, []);
        entries.get(offset).push(candidate);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return (line, column) => {
    const pos = starts[line] + column;
    if (pos >= (starts[line + 1] ?? text.length + 1)) return [];
    return entries.get(pos) ?? [];
  };
}

function sourceFor(root, mapFile, file, payload, sourceName) {
  let base = pathToFileURL(mapFile);
  if (payload.sourceRoot) {
    const dir = localFile(payload.sourceRoot, base);
    if (!dir) return;
    base = pathToFileURL(dir + path.sep);
  }
  const location = localFile(sourceName, base);
  if (!location || !/\.[cm]?ts$/i.test(location) || /\.d\.[cm]?ts$/i.test(location)) return;
  const actual = projectFile(root, location);
  if (!actual) return;
  const text = ts.sys.readFile(actual);
  if (text === undefined) return;
  const embedded = payload.sourcesContent?.[payload.sources.indexOf(sourceName)];
  if (typeof embedded === 'string') {
    if (text !== embedded && normalized(text) !== normalized(embedded)) return;
  } else if (
    statSync(actual).mtimeMs > Math.max(statSync(file).mtimeMs, statSync(mapFile).mtimeMs)
  ) {
    // tsc need not embed sources. A newer source cannot verify the old offsets.
    return;
  }
  return sourceIndex(actual, text, root);
}

function compatible(generated, candidate, jsMeta) {
  const { node, info } = candidate;
  if (
    ts.isMethodDeclaration(generated) !== ts.isMethodDeclaration(node) ||
    ts.isFunctionDeclaration(generated) !== ts.isFunctionDeclaration(node)
  )
    return false;
  // In particular, compiler-generated wrappers must never borrow a nearby controller method.
  return info.anonymous ? jsMeta.anonymous : jsMeta.name === info.name;
}

export function instrumentNest(root, file, source, warn) {
  let record;
  try {
    record = mapFor(root, file, source);
  } catch {
    /* invalid or inaccessible map */
  }
  if (!record) {
    warn('map', file);
    return source;
  }
  const { mapFile, map, payload } = record;
  const indices = new Map();
  return instrument(source, file, (node, ast) => {
    const jsMeta = methodMetadata(node, ast, file);
    const matches = new Set();
    let invalidSource = false;
    for (const offset of anchors(node, ast)) {
      const { line, character } = ast.getLineAndCharacterOfPosition(offset);
      const entry = map.findEntry(line, character);
      // findEntry also returns the nearest preceding segment when there is no exact mapping.
      if (
        entry.generatedLine !== line ||
        entry.generatedColumn !== character ||
        typeof entry.originalSource !== 'string'
      )
        continue;
      const name = entry.originalSource;
      if (!indices.has(name)) {
        let index;
        try {
          index = sourceFor(root, mapFile, file, payload, name);
        } catch {
          /* do not use unverifiable coordinates */
        }
        indices.set(name, index);
        if (!index) warn('source', file);
      }
      const index = indices.get(name);
      if (!index) {
        invalidSource = true;
        continue;
      }
      for (const candidate of index(entry.originalLine, entry.originalColumn)) {
        if (compatible(node, candidate, jsMeta)) matches.add(candidate);
      }
    }
    if (matches.size === 1) return matches.values().next().value.info;
    if (!invalidSource && ts.isMethodDeclaration(node)) warn('method', file);
  });
}

export function installNestSourceHook(project, entry, notify) {
  const filename = path.resolve(project, entry);
  const parts = path.relative(project, filename).split(path.sep);
  const dist = parts.findIndex((item) => /^(dist|build|out)$/i.test(item));
  const outDir =
    dist < 0 ? path.dirname(filename) : path.join(project, ...parts.slice(0, dist + 1));
  const seen = new Set();
  const reasons = {
    map: '未找到可用的本地 source map',
    source: 'source map 未对应当前项目的 TypeScript 源码',
    method: '部分方法缺少可核对的源码映射',
  };
  function warn(kind, file) {
    if (seen.has(kind)) return;
    seen.add(kind);
    notify(reasons[kind] + '（' + slash(path.relative(project, file)) + '），相应方法已跳过采集。');
  }
  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (!url.startsWith('file:')) return loaded;
      const file = fileURLToPath(url);
      if (!/\.[cm]?js$/i.test(file) || !within(outDir, file)) return loaded;
      try {
        const actual = projectFile(project, file);
        if (!actual || !within(outDir, actual)) return loaded;
        const text = Buffer.from(loaded.source ?? readFileSync(actual)).toString('utf8');
        return { ...loaded, source: instrumentNest(project, actual, text, warn) };
      } catch {
        warn('map', file);
        return loaded;
      }
    },
  });
}
