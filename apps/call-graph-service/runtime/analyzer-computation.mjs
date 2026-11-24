import path from 'node:path';
import ts from 'typescript-compiler';

const library = path.dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2023 }));
export function compilerLibrary(file) {
  return (
    /^lib\.[a-z0-9.]+\.d\.ts$/i.test(path.basename(file)) &&
    path.relative(library, path.dirname(file)) === ''
  );
}

// Resolve signatures against the analyzer's bundled TypeScript library. A remote
// client exposing get/map/values must not be mistaken for a Map or Array.
const methods = {
  Array:
    'at concat every filter find findIndex flat flatMap forEach includes indexOf join lastIndexOf map pop push reduce reduceRight reverse shift slice some sort splice unshift',
  ArrayConstructor: 'isArray',
  Date: 'getTime getDate getDay getFullYear getHours getMinutes getMonth getSeconds getUTCDate getUTCFullYear getUTCMonth setDate setHours setTime toISOString',
  DateConstructor: 'parse UTC now',
  Map: 'get has set delete clear entries keys values',
  Set: 'has add delete clear entries keys values',
  Math: 'abs round ceil floor max min trunc pow sign sqrt log log2 exp sin cos tan hypot imul fround',
  Number: 'toFixed toString toPrecision',
  NumberConstructor: 'isInteger isSafeInteger isFinite isNaN parseInt parseFloat',
  ObjectConstructor: 'is keys hasOwn',
  RegExp: 'test exec',
  String:
    'at charAt charCodeAt endsWith includes indexOf lastIndexOf match padEnd padStart replace replaceAll search slice split startsWith substr substring toLowerCase toUpperCase trim trimEnd trimStart',
};
const allowed = new Map(
  Object.entries(methods).map(([owner, members]) => [owner, new Set(members.split(' '))]),
);
allowed.set('ReadonlyArray', allowed.get('Array'));
allowed.set('ReadonlyMap', allowed.get('Map'));
allowed.set('ReadonlySet', allowed.get('Set'));
const scalarConverters = new Set([
  'NumberConstructor',
  'StringConstructor',
  'BooleanConstructor',
  'BigIntConstructor',
]);
const numericGlobals = new Set([
  'parseInt',
  'parseFloat',
  'isFinite',
  'isNaN',
  'encodeURIComponent',
  'decodeURIComponent',
]);
const callbackMethods = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'reduceRight',
  'some',
  'sort',
]);

function intrinsicSignature(call, checker) {
  const sig = checker.getResolvedSignature(call)?.getDeclaration();
  return sig && compilerLibrary(sig.getSourceFile().fileName) ? sig : undefined;
}

export function synchronousBuiltin(call, checker, knownCallback) {
  const sig = intrinsicSignature(call, checker);
  if (!sig) {
    const expr = call.expression;
    if (
      !ts.isPropertyAccessExpression(expr) ||
      !ts.isIdentifier(expr.expression) ||
      !['isObjectLike', 'isEmpty'].includes(expr.name.text)
    )
      return false;
    const imported = checker
      .getSymbolAtLocation(expr.expression)
      ?.declarations?.find(ts.isImportClause);
    return !!imported && ['lodash', 'lodash-es'].includes(imported.parent.moduleSpecifier.text);
  }
  if (ts.isFunctionDeclaration(sig)) return numericGlobals.has(sig.name?.text);
  const owner = sig.parent.name?.text;
  if (ts.isCallSignatureDeclaration(sig)) return scalarConverters.has(owner);
  const method = sig.name?.getText(sig.getSourceFile());
  if (!allowed.get(owner)?.has(method)) return false;
  if (callbackMethods.has(method))
    return (
      (!call.arguments.length && method === 'sort') ||
      (!!call.arguments[0] && knownCallback(call.arguments[0]))
    );
  if (method === 'replace' || method === 'replaceAll') {
    const replacement = call.arguments[1];
    return (
      !!replacement && !!(checker.getTypeAtLocation(replacement).flags & ts.TypeFlags.StringLike)
    );
  }
  return true;
}

function synchronousConstructor(node, checker) {
  const sig = intrinsicSignature(node, checker);
  const owner = sig?.parent.name?.text;
  if (owner === 'DateConstructor' || owner === 'RegExpConstructor') return true;
  return (owner === 'MapConstructor' || owner === 'SetConstructor') && !node.arguments?.length;
}

export function returnsDeferredValue(fn, checker) {
  const sig = checker.getSignatureFromDeclaration(fn);
  if (!sig) return true;
  const result = checker.getReturnTypeOfSignature(sig);
  return (result.isUnion() ? result.types : [result]).some(
    (type) => type.getCallSignatures().length > 0 || !!checker.getPropertyOfType(type, 'then'),
  );
}

/** These constructs can transfer control to code outside ordinary call edges. */
export function requiresRuntime(node, checker) {
  if (
    ts.isAwaitExpression(node) ||
    ts.isYieldExpression(node) ||
    ts.isTaggedTemplateExpression(node) ||
    ts.isDeleteExpression(node) ||
    (ts.isForOfStatement(node) && node.awaitModifier)
  )
    return true;
  if (ts.isNewExpression(node)) return !synchronousConstructor(node, checker);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const property = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
    if (
      checker
        .getSymbolAtLocation(property)
        ?.declarations?.some((d) => ts.isGetAccessor(d) || ts.isSetAccessor(d))
    )
      return true;
  }
  if (
    ts.isTypeReferenceNode(node) &&
    /^(?:Promise|PromiseLike|AsyncIterable|AsyncGenerator)$/.test(node.typeName.getText())
  )
    return true;
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    if (!ts.isIdentifier(node.left)) return true;
  }
  return false;
}

/** Prove leaves first. Unknown operations, incomplete analysis, and unresolved cycles
 * stay visible. A project method qualifies only after every transitive callee qualifies. */
export function markComputations(nodes, edges, blocked) {
  const callers = new Map();
  const remaining = new Map();
  for (const { from, to } of edges.values()) {
    if (!callers.has(to)) callers.set(to, []);
    callers.get(to).push(from);
    remaining.set(from, (remaining.get(from) ?? 0) + 1);
  }
  const pending = [];
  for (const n of nodes.values()) {
    n.computationOnly = false;
    if (!blocked.has(n.id) && !remaining.has(n.id)) pending.push(n.id);
  }
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    nodes.get(id).computationOnly = true;
    for (const caller of callers.get(id) ?? []) {
      remaining.set(caller, remaining.get(caller) - 1);
      if (!remaining.get(caller) && !blocked.has(caller)) pending.push(caller);
    }
  }
}
