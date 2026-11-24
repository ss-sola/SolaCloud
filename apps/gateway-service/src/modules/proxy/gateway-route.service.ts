import { Injectable } from '@nestjs/common';
import { GATEWAY_ROUTE_GROUPS, type GatewayRoute } from '../../constants/gateway-routes.constants';
import { UPSTREAM } from '../../constants/gateway.constants';

const RUNTIME_DICTIONARY_PATH = '/api/system/dictionaries/runtime';
const RUNTIME_DICTIONARY_QUERY_KEYS = new Set(['namespace', 'aggregateKey', 'keys']);

@Injectable()
export class GatewayRouteService {
  getPath(target: string): string | undefined {
    const path = target.split('?', 1)[0];
    return /^\/(?:[a-z0-9-]+\/)*[a-z0-9-]+$/.test(path) ? path : undefined;
  }

  find(method: string, path: string, query: string): GatewayRoute | undefined {
    const verb = method === 'HEAD' ? 'GET' : method;
    if (path === RUNTIME_DICTIONARY_PATH) {
      const params = new URLSearchParams(query);
      const namespaces = params.getAll('namespace');
      if (
        namespaces.length !== 1 ||
        namespaces[0] !== 'common' ||
        [...params.keys()].some((key) => !RUNTIME_DICTIONARY_QUERY_KEYS.has(key))
      )
        return undefined;
    }
    if (method === 'GET' && path === '/api/call-graph/events') {
      return { upstream: UPSTREAM.callGraph, streaming: true };
    }
    if (verb === 'POST' && path === '/api/chat/send') {
      return { upstream: UPSTREAM.rag, streaming: true };
    }
    if (verb === 'GET' && /^\/api\/knowledge\/document\/[1-9]\d*$/.test(path)) {
      return { upstream: UPSTREAM.rag };
    }
    const group = GATEWAY_ROUTE_GROUPS.find(({ prefix }) => path.startsWith(prefix));
    if (group?.routes[verb]?.includes(path.slice(group.prefix.length))) {
      return { upstream: group.upstream };
    }
    return undefined;
  }
}
