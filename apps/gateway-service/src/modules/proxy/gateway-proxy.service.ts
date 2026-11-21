import { ContextService, getConfig, ResponseUtil } from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Transform } from 'node:stream';
import type { GatewayRoute } from '../../constants/gateway-routes.constants';
import { GATEWAY_HOP_HEADER, GatewayHeadersUtil } from '../../utils/gateway-headers.util';
import { GatewayConfig } from '../../validate.config';
import { GatewayRouteService } from './gateway-route.service';
import { GatewayUpstreamService, type GatewayTarget } from './gateway-upstream.service';

type Exchange = {
  request: Request;
  response: Response;
  path: string;
  route: GatewayRoute;
  target: GatewayTarget;
};

@Injectable()
export class GatewayProxyService {
  private readonly log = new Logger(GatewayProxyService.name);
  private readonly trustedProxyIps = GatewayConfig.trustedProxyIps();
  private readonly allowedOrigins = GatewayConfig.allowedOrigins();
  private readonly connectMs = getConfig<number>('GatewayConnectTimeoutMs');
  private readonly idleMs = getConfig<number>('GatewayIdleTimeoutMs');
  private readonly streamIdleMs = getConfig<number>('GatewayStreamIdleTimeoutMs');
  private readonly maxBodyBytes = getConfig<number>('GatewayMaxBodyBytes');

  constructor(
    private readonly routes: GatewayRouteService,
    private readonly upstreams: GatewayUpstreamService,
  ) {}

  forward(request: Request, response: Response): void {
    response.vary('Origin');
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (!this.allowedOrigins.has(origin)) return this.fail(response, 403, '请求来源未获准');
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    const path = this.routes.getPath(request.originalUrl);
    if (!path) return this.fail(response, 400, '请求路径格式错误');
    const preflightMethod =
      request.method === 'OPTIONS' && origin
        ? request.get('Access-Control-Request-Method')
        : undefined;
    if (request.method === 'OPTIONS') response.vary('Access-Control-Request-Method');
    const route = this.routes.find(
      preflightMethod ?? request.method,
      path,
      request.originalUrl.slice(path.length + 1),
    );
    if (!route) return this.fail(response, 404, '接口未找到');
    if (preflightMethod) {
      response.setHeader('Access-Control-Allow-Methods', preflightMethod);
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.status(204).end();
      return;
    }
    if (request.headers[GATEWAY_HOP_HEADER]) return this.fail(response, 502, '上游路由形成循环');
    if (Number(request.headers['content-length']) > this.maxBodyBytes) {
      request.resume();
      response.setHeader('Connection', 'close');
      return this.fail(response, 413, '请求体过大');
    }
    const target = this.upstreams.select(route.upstream);
    if (!target) return this.fail(response, 503, '服务暂不可用');
    this.exchange({ request, response, path, route, target });
  }

  private exchange({ request, response, path, route, target }: Exchange): void {
    const startedAtMs = Date.now();
    const trace = ContextService.createOutboundTrace('gateway.proxy');
    if (!response.hasHeader('x-trace-id')) response.setHeader('x-trace-id', trace.traceId);
    let incoming: IncomingMessage | undefined;
    let outgoing: ClientRequest | undefined;
    let connectTimer: NodeJS.Timeout | undefined;
    let completed = false;
    let byteCount = 0;
    const limit = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        byteCount += chunk.length;
        if (byteCount > this.maxBodyBytes) callback(new Error('request_body_limit'));
        else callback(null, chunk);
      },
    });

    const finish = (error?: string, status = response.statusCode) => {
      if (completed) return;
      completed = true;
      clearTimeout(connectTimer);
      request.unpipe(limit);
      limit.destroy();
      if (error) {
        incoming?.destroy();
        outgoing?.destroy();
      }
      trace.end(error ?? (status >= 500 ? status : undefined));
      this.log.log({
        method: request.method,
        path,
        service: route.upstream,
        instance: target.instanceId,
        upstreamAddress: target.address.port
          ? target.address.host
          : target.address.hostname + (target.address.protocol === 'https:' ? ':443' : ':80'),
        status,
        startedAtMs,
        durationMs: Date.now() - startedAtMs,
        traceId: trace.traceId,
        error,
      });
    };

    const reject = (status: number, reason: string, message: string) => {
      if (completed) return;
      finish(reason, status);
      if (response.headersSent) {
        response.destroy();
      } else if (!response.destroyed) {
        if (!request.complete) {
          response.setHeader('Connection', 'close');
          request.resume();
        }
        this.fail(response, status, message);
      }
    };

    response.once('finish', () => finish());
    response.once('close', () => {
      if (!response.writableFinished) finish('client_disconnected');
    });
    request.once('aborted', () => finish('client_disconnected'));
    limit.once('error', () => reject(413, 'request_body_limit', '请求体过大'));

    const send = target.address.protocol === 'https:' ? httpsRequest : httpRequest;
    outgoing = send(
      target.address,
      {
        method: request.method,
        path: request.originalUrl,
        headers: { ...GatewayHeadersUtil.request(request, this.trustedProxyIps), ...trace.headers },
      },
      (upstream) => {
        incoming = upstream;
        if (completed) {
          upstream.destroy();
          return;
        }
        for (const [name, value] of Object.entries(GatewayHeadersUtil.response(upstream.headers))) {
          if (value === undefined) continue;
          if (name === 'vary') response.vary(String(value));
          else response.setHeader(name, value);
        }
        upstream.once('error', () => reject(502, 'upstream_response_error', '上游响应异常'));
        upstream.once('aborted', () => reject(502, 'upstream_response_aborted', '上游响应中断'));
        response.status(upstream.statusCode ?? 502);
        response.flushHeaders();
        upstream.pipe(response);
      },
    );
    outgoing.once('error', () => reject(502, 'upstream_request_error', '无法连接上游服务'));
    connectTimer = setTimeout(
      () => reject(504, 'upstream_connect_timeout', '连接上游服务超时'),
      this.connectMs,
    );
    outgoing.once('socket', (socket) => {
      if (socket.connecting) socket.once('connect', () => clearTimeout(connectTimer));
      else clearTimeout(connectTimer);
    });
    outgoing.setTimeout(route.streaming ? this.streamIdleMs : this.idleMs, () =>
      reject(504, 'upstream_idle_timeout', '等待上游响应超时'),
    );
    request.pipe(limit).pipe(outgoing);
  }

  private fail(response: Response, status: number, message: string): void {
    response.status(status).json(ResponseUtil.error(message, status));
  }
}
