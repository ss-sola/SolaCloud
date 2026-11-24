import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript-compiler';

export const skippedDirs = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
  'test',
  'tests',
  '__tests__',
  '__test__',
]);

export function sourceFiles(dir) {
  const files = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink() || item.name.startsWith('.') || skippedDirs.has(item.name)) continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...sourceFiles(file));
    else if (
      item.isFile() &&
      /\.[cm]?[jt]s$/i.test(file) &&
      !/(?:\.d|[.-]spec|\.test)\.[cm]?[jt]s$/i.test(file)
    )
      files.push(file.replaceAll('\\', '/'));
  }
  return files;
}

/** Bound actual file reads as well as lexical paths when a project contains a link. */
export function inProject(root, file) {
  try {
    const relative = path.relative(root, fs.realpathSync(file));
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

export function unwrapped(node) {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node))
  )
    node = node.expression;
  return node;
}
