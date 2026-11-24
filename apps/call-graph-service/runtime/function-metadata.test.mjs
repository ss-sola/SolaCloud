import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript-compiler';
import { functionMetadata } from './function-metadata.mjs';

test('识别直接绑定的箭头或函数表达式，并区分无名函数、内联回调和返回的闭包', () => {
  const code = `
    const emit = (() => 1) satisfies Function;
    const storage = { save: () => 2, ['read']: function () { return 3 } };
    storage.drop = () => 4;
    const late = () => async () => 5;
    const grouped = [1,2].map(function explicitlyNamed(n) { return n }).map(n => n * 2);
    class Work { schedule = () => 6; run() {} }
    export default () => 7;
  `;
  const source = ts.createSourceFile('methods.ts', code, ts.ScriptTarget.Latest, true);
  const named = [];
  const anonymous = [];
  function visit(node) {
    if (ts.isFunctionLike(node) && node.body) {
      const meta = functionMetadata(node, source, 1);
      if (meta.anonymous) anonymous.push(node.getText(source));
      else named.push(meta.name);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.deepEqual(named, [
    'emit',
    'save',
    'read',
    'drop',
    'late',
    'explicitlyNamed',
    'schedule',
    'Work.run',
  ]);
  assert.deepEqual(anonymous, ['async () => 5', 'n => n * 2', '() => 7']);
});
