import ts from 'typescript-compiler';
import { unwrapped } from './analyzer-source.mjs';
import { bullMqNode } from './bullmq-node.mjs';

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function namedProperty(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteralLike(expression.argumentExpression)
  )
    return expression.argumentExpression.text;
}

function requiresBullMq(node) {
  return (
    node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]) &&
    node.arguments[0].text === 'bullmq'
  );
}

export function queueGraph(program, { declaration, callee, returned }) {
  const checker = program.getTypeChecker();
  const assignments = new Map();
  let workers;

  function bullMqImport(node, expected) {
    const symbol = checker.getSymbolAtLocation(node);
    for (const decl of symbol?.declarations ?? []) {
      if (ts.isImportSpecifier(decl)) {
        const clause = decl.parent.parent;
        if (
          !decl.isTypeOnly &&
          !clause.isTypeOnly &&
          (decl.propertyName ?? decl.name).text === expected &&
          clause.parent.moduleSpecifier.text === 'bullmq'
        )
          return true;
      }
      if (
        ts.isBindingElement(decl) &&
        (decl.propertyName ?? decl.name).getText() === expected &&
        requiresBullMq(decl.parent.parent.initializer)
      )
        return true;
      // Qualified access such as bullmq.Queue or require('bullmq').Queue.
      if (
        expected === undefined &&
        ((ts.isNamespaceImport(decl) &&
          !decl.parent.isTypeOnly &&
          decl.parent.parent.moduleSpecifier.text === 'bullmq') ||
          (ts.isVariableDeclaration(decl) && requiresBullMq(decl.initializer)))
      )
        return true;
    }
    return false;
  }

  function isConstructor(node, kind) {
    const ref = unwrapped(node.expression);
    if (ts.isIdentifier(ref)) return bullMqImport(ref, kind);
    if (namedProperty(ref) !== kind) return false;
    return requiresBullMq(ref.expression) || bullMqImport(ref.expression, undefined);
  }

  function stringValue(expression, seen = new Set()) {
    const node = unwrapped(expression);
    if (!node || seen.has(node) || seen.size > 30) return;
    seen.add(node);
    if (ts.isStringLiteralLike(node)) return node.text;
    const constant = checker.getConstantValue(node);
    if (typeof constant === 'string') return constant;
    return stringValue(declaration(node)?.initializer, seen);
  }

  function variableAssignments(decl) {
    const source = decl.getSourceFile();
    if (!assignments.has(source)) {
      const writes = new Map();
      walk(source, (node) => {
        if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
          return;
        const target = declaration(node.left);
        if (!target || target.getSourceFile() !== source) return;
        const values = writes.get(target) ?? [];
        values.push(node.right);
        writes.set(target, values);
      });
      assignments.set(source, writes);
    }
    return assignments.get(source).get(decl) ?? [];
  }

  function queueNames(expression, bindings, seen = new Set()) {
    const node = unwrapped(expression);
    if (!node || seen.has(node) || seen.size > 30) return [];
    const trail = new Set([...seen, node]);
    if (ts.isNewExpression(node)) {
      const name = isConstructor(node, 'Queue') && stringValue(node.arguments?.[0]);
      return name ? [name] : [];
    }
    if (ts.isCallExpression(node)) {
      const fn = callee(node, bindings);
      if (fn) return returned(fn).flatMap((value) => queueNames(value, bindings, trail));
      if (namedProperty(node.expression) === 'on')
        return queueNames(node.expression.expression, bindings, trail);
      return [];
    }
    const decl = declaration(node);
    if (!decl || decl.getSourceFile().isDeclarationFile) return [];
    const values = [decl.initializer, ...variableAssignments(decl)];
    return values.flatMap((value) => queueNames(value, bindings, trail));
  }

  function collectWorkers() {
    const found = new Map();
    for (const file of program.getSourceFiles()) {
      if (file.isDeclarationFile || !file.text.includes('bullmq')) continue;
      walk(file, (node) => {
        if (!ts.isNewExpression(node) || !isConstructor(node, 'Worker')) return;
        const name = stringValue(node.arguments?.[0]);
        const callback = node.arguments?.[1];
        if (!name || !callback) return;
        const callbacks = found.get(name) ?? [];
        callbacks.push(callback);
        found.set(name, callbacks);
      });
    }
    return found;
  }

  return (call, bindings) => {
    if (namedProperty(call.expression) !== 'add') return;
    const job = stringValue(call.arguments[0]);
    if (!job) return;
    const queue = [...new Set(queueNames(call.expression.expression, bindings))];
    if (queue.length !== 1) return;
    workers ??= collectWorkers();
    const callbacks = workers.get(queue[0]) ?? [];
    return {
      enqueue: bullMqNode('queue', queue[0], job),
      worker: bullMqNode('worker', queue[0], job, 1),
      callbacks,
    };
  };
}
