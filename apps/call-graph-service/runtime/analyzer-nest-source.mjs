import ts from 'typescript-compiler';
import { unwrapped } from './analyzer-source.mjs';

/** Read Nest metadata from the project's own syntax without importing its modules. */
export function nestSource(program) {
  const checker = program.getTypeChecker();
  function symbol(expr) {
    if (!expr) return;
    return checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expr) ? expr.name : expr);
  }
  function declaration(expr) {
    let sym = symbol(expr);
    if (sym?.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return sym?.valueDeclaration ?? sym?.declarations?.[0];
  }
  function value(expr, seen = new Set()) {
    const node = unwrapped(expr);
    if (!node || seen.has(node)) return;
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return node;
    const decl = declaration(node);
    if (decl && ts.isClassDeclaration(decl)) return decl;
    if (
      decl &&
      (ts.isEnumMember(decl) ||
        ts.isPropertyAssignment(decl) ||
        (ts.isVariableDeclaration(decl) && decl.parent.flags & ts.NodeFlags.Const))
    ) {
      seen.add(node);
      return value(decl.initializer, seen);
    }
    return node;
  }
  function member(object, name) {
    const node = value(object);
    if (!node || !ts.isObjectLiteralExpression(node)) return;
    const prop = node.properties.find((p) => p.name?.text === name);
    if (prop && ts.isShorthandPropertyAssignment(prop)) {
      return (
        checker.getShorthandAssignmentValueSymbol(prop)?.valueDeclaration?.initializer ?? prop.name
      );
    }
    return prop?.initializer;
  }
  function list(expr, onUnknown, seen = new Set()) {
    const node = value(expr);
    if (!node || !ts.isArrayLiteralExpression(node) || seen.has(node)) {
      onUnknown(expr);
      return [];
    }
    const trail = new Set([...seen, node]);
    return node.elements.flatMap((e) =>
      ts.isSpreadElement(e) ? list(e.expression, onUnknown, trail) : [e],
    );
  }
  function strings(expr, seen = new Set()) {
    const node = value(expr);
    if (!node || seen.has(node)) return [];
    const trail = new Set([...seen, node]);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isNumericLiteral(node)) return [node.text];
    if (ts.isArrayLiteralExpression(node)) {
      let known = true;
      const entries = list(node, () => {
        known = false;
      }).map((e) => strings(e, trail));
      return known && entries.every((e) => e.length) ? entries.flat() : [];
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const a = strings(node.left, trail),
        b = strings(node.right, trail);
      if (a.length === 1 && b.length === 1) return [a[0] + b[0]];
    }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const parts = strings(span.expression, trail);
        if (parts.length !== 1) return [];
        text += parts[0] + span.literal.text;
      }
      return [text];
    }
    return [];
  }
  function imported(expr, pkg) {
    const original = unwrapped(expr);
    if (!original) return;
    if (ts.isPropertyAccessExpression(original)) {
      const ns = symbol(original.expression)?.declarations?.find(ts.isNamespaceImport);
      if (ns?.parent.parent.moduleSpecifier.text === pkg) return original.name.text;
    }
    const binding = symbol(original)?.declarations?.find(ts.isImportSpecifier);
    if (binding?.parent.parent.parent.moduleSpecifier.text === pkg)
      return (binding.propertyName ?? binding.name).text;
  }
  function decorators(node) {
    return (ts.getDecorators(node) ?? []).flatMap((d) => {
      const call = d.expression;
      if (!ts.isCallExpression(call)) return [];
      const name = imported(call.expression, '@nestjs/common');
      return name ? [{ name, args: call.arguments, node: d }] : [];
    });
  }
  return { value, member, list, strings, imported, decorators, declaration, symbol };
}
