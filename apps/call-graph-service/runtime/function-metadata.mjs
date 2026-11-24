import ts from 'typescript-compiler';

function propertyName(name, ast) {
  if (!name) return undefined;
  if (ts.isComputedPropertyName(name)) {
    const key = name.expression;
    return ts.isStringLiteralLike(key) || ts.isNumericLiteral(key) ? key.text : undefined;
  }
  return ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : name.getText(ast);
}

/** Use the source binding for both discovery and recording. Merely nesting a callback
 * inside a named function does not give the nested function a name. */
export function functionMetadata(node, ast, line) {
  let outer = node;
  while (ts.isOuterExpression(outer.parent) && outer.parent.expression === outer)
    outer = outer.parent;
  const parent = outer.parent;
  const binding = parent.initializer === outer ? propertyName(parent.name, ast) : undefined;
  let assigned;
  if (
    ts.isBinaryExpression(parent) &&
    parent.right === outer &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    if (ts.isIdentifier(parent.left)) assigned = parent.left.text;
    else if (ts.isPropertyAccessExpression(parent.left)) assigned = parent.left.name.text;
    else if (
      ts.isElementAccessExpression(parent.left) &&
      ts.isStringLiteralLike(parent.left.argumentExpression)
    )
      assigned = parent.left.argumentExpression.text;
  }
  const declared = node.name?.getText(ast);
  const sourceName = declared ?? binding ?? assigned;
  // Keep the function.name inference that the probe's wrapper would otherwise erase.
  const expression = ts.isArrowFunction(node) || ts.isFunctionExpression(node);
  const inferredName =
    expression && !declared
      ? (binding ??
        (assigned && ts.isBinaryExpression(parent) && ts.isIdentifier(parent.left)
          ? assigned
          : undefined) ??
        (ts.isExportAssignment(parent) ? 'default' : undefined))
      : undefined;
  if (sourceName !== undefined) {
    const owner = node.parent;
    const qualified =
      (ts.isClassDeclaration(owner) || ts.isClassExpression(owner)) && owner.name
        ? owner.name.getText(ast) + '.' + sourceName
        : sourceName;
    return { name: qualified, anonymous: false, inferredName };
  }
  const call = ts.isCallExpression(parent) && parent.expression;
  const callee =
    call &&
    (ts.isPropertyAccessExpression(call)
      ? call.name.text
      : ts.isIdentifier(call)
        ? call.text
        : undefined);
  return {
    name: (callee ? callee + ' 回调' : '回调') + ' L' + line,
    anonymous: true,
    inferredName,
  };
}
