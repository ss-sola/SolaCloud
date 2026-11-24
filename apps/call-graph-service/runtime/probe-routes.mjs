import { parse, tokensToRegexp } from 'path-to-regexp';
import { parse as parseNest, pathToRegexp } from 'path-to-regexp-nest';

const pathKey = (value) => (value.replace(/\/$/, '') || '/').toLowerCase();

function compileKoa(path) {
  const tokens = parse(path);
  if (tokens.every((token) => typeof token === 'string')) return { literal: tokens.join('') };
  return {
    pattern: tokensToRegexp(tokens),
    literalLength: tokens.reduce(
      (n, token) => n + (typeof token === 'string' ? token.length : 0),
      0,
    ),
    wildcards: tokens.filter(
      (token) => typeof token !== 'string' && (token.pattern.includes('.*') || token.modifier),
    ).length,
  };
}

function compileNest(path) {
  const data = parseNest(path);
  if (data.tokens.every((token) => token.type === 'text'))
    return { literal: data.tokens.map((token) => token.value).join('') };
  return {
    pattern: pathToRegexp(data).regexp,
    literalLength: data.tokens.reduce(
      (n, token) => n + (token.type === 'text' ? token.value.length : 0),
      0,
    ),
    wildcards: data.tokens.filter((token) => token.type === 'group' || token.type === 'wildcard')
      .length,
  };
}

/** Keep Express 5 / Nest 11 named wildcards and optional groups in their native dialect.
 * Older Nest routers can still register a legacy Koa-style parameter template. */
function compile(path, framework) {
  if (framework === 'nestjs') {
    try {
      return compileNest(path);
    } catch {
      /* Try the older router syntax. */
    }
  }
  try {
    return compileKoa(path);
  } catch {
    return { literal: path };
  }
}

/** Index literal paths by verb. Only parameterized templates need a regexp at request time. */
export function createRouteMatcher(routes, framework = 'koa') {
  const methods = new Map();
  for (const route of routes) {
    const method = route.method.toUpperCase();
    if (!methods.has(method)) methods.set(method, { literals: new Map(), patterns: [] });
    const { literals, patterns } = methods.get(method);
    const candidate = { ...route, method, roots: new Set(route.roots) };
    const compiled = compile(route.path, framework);
    if (compiled.literal !== undefined) {
      const key = pathKey(compiled.literal);
      if (!literals.has(key)) literals.set(key, []);
      literals.get(key).push(candidate);
      continue;
    }
    patterns.push({ candidate, ...compiled });
  }
  for (const { patterns } of methods.values()) {
    patterns.sort((a, b) => b.literalLength - a.literalLength || a.wildcards - b.wildcards);
  }
  return (method, pathname) => {
    const verb = method.toUpperCase();
    const verbs = verb === 'HEAD' ? ['HEAD', 'GET', 'ALL'] : [verb, 'ALL'];
    const matches = [];
    const key = pathKey(pathname);
    for (const item of new Set(verbs)) {
      const bucket = methods.get(item);
      if (!bucket) continue;
      const exact = bucket.literals.get(key);
      if (exact) matches.push(...exact);
      for (const { candidate, pattern } of bucket.patterns) {
        if (pattern.test(pathname)) matches.push(candidate);
      }
    }
    return matches;
  };
}

/** Koa sets its matched layer template before calling its middleware. Different
 * declarations may share a handler or match the same path, so consult both. */
export function matchRouteRoot(candidates, nodeId, matchedRoute) {
  const actual =
    matchedRoute &&
    candidates.find((route) => route.path === matchedRoute && route.roots.has(nodeId));
  return actual || candidates.find((route) => route.roots.has(nodeId));
}
