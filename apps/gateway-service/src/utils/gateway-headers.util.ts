import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import type { Request } from 'express';

const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export const GATEWAY_HOP_HEADER = 'x-solacloud-gateway-hop';

export class GatewayHeadersUtil {
  static request(request: Request, trustedProxyIps: ReadonlySet<string>): IncomingHttpHeaders {
    const headers = this.endToEnd(request.headers);
    for (const name of Object.keys(headers)) {
      if (name.startsWith('x-forwarded-')) delete headers[name];
    }
    for (const name of [
      'forwarded',
      'x-real-ip',
      'host',
      'expect',
      'x-trace-id',
      'traceparent',
      'tracestate',
    ]) {
      delete headers[name];
    }

    const peer = (request.socket.remoteAddress ?? '').replace(/^::ffff:/i, '');
    const trusted = trustedProxyIps.has(peer);
    const reportedIp = request.headers['x-forwarded-for'];
    const reportedProtocol = request.headers['x-forwarded-proto'];
    // A trusted ingress replaces these headers with a single client IP and scheme.
    const clientIp =
      trusted && typeof reportedIp === 'string' && isIP(reportedIp) ? reportedIp : peer;
    if (clientIp) headers['x-forwarded-for'] = clientIp;
    headers['x-forwarded-proto'] =
      trusted && reportedProtocol === 'https' ? 'https' : request.protocol;
    if (request.headers.host) headers['x-forwarded-host'] = request.headers.host;
    headers[GATEWAY_HOP_HEADER] = '1';
    return headers;
  }

  static response(source: IncomingHttpHeaders): IncomingHttpHeaders {
    const headers = this.endToEnd(source);
    for (const name of Object.keys(headers)) {
      if (name.startsWith('access-control-')) delete headers[name];
    }
    delete headers['x-trace-id'];
    delete headers[GATEWAY_HOP_HEADER];
    return headers;
  }

  private static endToEnd(source: IncomingHttpHeaders): IncomingHttpHeaders {
    const headers = { ...source };
    for (const name of hopHeaders) delete headers[name];
    for (const name of (source.connection ?? '').split(','))
      delete headers[name.trim().toLowerCase()];
    return headers;
  }
}
