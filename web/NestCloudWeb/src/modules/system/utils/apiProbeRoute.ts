import { matchPath } from 'react-router-dom';
import type { AgentEvent, ProjectRoute } from '../api/apiCallGraph';

type RequestEvent = Extract<AgentEvent, { type: 'request' }>;

/** Old request events contain a URL instead of the scanner's route ID. Only
 * attribute one when the HTTP method and path identify one catalog entry. */
export function requestRouteResolver(routes: readonly ProjectRoute[]) {
  const ids = new Set(routes.map((route) => route.id));
  // React Router and Koa agree on literals and whole-segment named parameters.
  // A custom capture or modifier could overlap one of those templates. On older
  // streams without a route ID, leave that URL unattributed instead of guessing.
  const legacy = routes.map((route) => {
    const parts = route.path.split('/');
    const parameter = /[:*?+(){}\\]/;
    const custom = parts.some((part) => parameter.test(part) && !/^:[\w-]+\??$/.test(part));
    const firstParameter = parts.findIndex((part) => parameter.test(part));
    return {
      route,
      uncertainPrefix: custom
        ? (parts.slice(0, firstParameter).join('/') + '/').toLowerCase()
        : undefined,
    };
  });
  return (event: RequestEvent) => {
    if (event.routeId !== undefined) return ids.has(event.routeId) ? event.routeId : undefined;
    const path = event.path.split('?')[0];
    let match: string | undefined;
    const verb = event.method.toUpperCase();
    for (const { route, uncertainPrefix } of legacy) {
      if (
        route.method !== verb &&
        route.method !== 'ALL' &&
        !(verb === 'HEAD' && route.method === 'GET')
      )
        continue;
      if (uncertainPrefix !== undefined && route.path !== path) {
        const normalized = path.toLowerCase();
        if (normalized.startsWith(uncertainPrefix) || normalized === uncertainPrefix.slice(0, -1))
          return undefined;
        continue;
      }
      if (route.path !== path && !matchPath({ path: route.path, end: true }, path)) continue;
      if (match !== undefined) return undefined;
      match = route.id;
    }
    return match;
  };
}
