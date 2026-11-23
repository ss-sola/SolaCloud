import { RegistryClientService, type ServiceInstance } from '@nest-cloud/sdk';
import express from 'express';
import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GATEWAY_DEFAULTS, UPSTREAM } from '../constants/gateway.constants';
import { GatewayProxyService } from '../modules/proxy/gateway-proxy.service';
import { GatewayRouteService } from '../modules/proxy/gateway-route.service';
import { GatewayUpstreamService } from '../modules/proxy/gateway-upstream.service';

const config = vi.hoisted(() => new Map<string, number | string>());
vi.mock('@nest-cloud/sdk', async (importOriginal) => {
  const original = await importOriginal<typeof import('@nest-cloud/sdk')>();
  return {
    ...original,
    getConfig: (key: string, fallback?: unknown) => config.get(key) ?? fallback,
  };
});

const servers: Server[] = [];
async function listen(requestListener: RequestListener): Promise<string> {
  const server = createServer(requestListener);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  servers.push(server);
  return 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
}

async function gateway(upstream: RequestListener): Promise<string> {
  const url = await listen(upstream);
  for (const key of ['GatewaySystemUrl', 'GatewayMiddlewareUrl', 'GatewayRagUrl'])
    config.set(key, url);
  config.set('GatewayConnectTimeoutMs', 1_000);
  config.set('GatewayIdleTimeoutMs', 2_000);
  config.set('GatewayStreamIdleTimeoutMs', 5_000);
  config.set('GatewayMaxBodyBytes', 1024);
  const proxy = new GatewayProxyService(
    new GatewayRouteService(),
    new GatewayUpstreamService({} as RegistryClientService),
  );
  const app = express();
  app.use((request, response) => proxy.forward(request, response));
  return listen(app);
}

afterEach(async () => {
  config.clear();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

describe('gateway HTTP transport', () => {
  it('preserves the original URL, multipart bytes, status, and distinct cookies', async () => {
    const body =
      '--test\r\nContent-Disposition: form-data; name="file"; filename="x.txt"\r\n\r\nabc\r\n--test--\r\n';
    const origin = await gateway(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      response.writeHead(206, {
        'Content-Type': 'application/json',
        'Set-Cookie': ['a=one; Path=/', 'b=two; Path=/'],
        'Access-Control-Allow-Origin': '*',
        Vary: 'Accept-Encoding, Origin',
      });
      response.end(
        JSON.stringify({
          method: request.method,
          path: request.url,
          body: Buffer.concat(chunks).toString(),
          contentType: request.headers['content-type'],
          cookie: request.headers.cookie,
          forwarding: request.headers['x-forwarded-for'],
          trace: request.headers.traceparent,
        }),
      );
    });

    const response = await fetch(origin + '/api/file/upload?ref=%2f&x=1&x=2', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=test',
        Cookie: 'solacloud.sid=abc',
        Origin: 'http://localhost:5173',
        'X-Forwarded-For': '192.0.2.125',
      },
      body,
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('vary')?.split(/,\s*/)).toEqual(['Origin', 'Accept-Encoding']);
    expect(response.headers.getSetCookie()).toEqual(['a=one; Path=/', 'b=two; Path=/']);
    expect(await response.json()).toMatchObject({
      method: 'POST',
      path: '/api/file/upload?ref=%2f&x=1&x=2',
      body,
      contentType: 'multipart/form-data; boundary=test',
      cookie: 'solacloud.sid=abc',
      forwarding: '127.0.0.1',
      trace: expect.stringContaining(response.headers.get('x-trace-id')!),
    });
  });

  it('answers preflight for exposed routes and rejects disallowed browser origins', async () => {
    config.set('GatewayAllowedOrigins', 'https://web.example.com');
    const upstream = vi.fn<RequestListener>();
    const origin = await gateway(upstream);
    const preflight = (path: string, method: string) =>
      fetch(origin + path, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://web.example.com',
          'Access-Control-Request-Method': method,
          'Access-Control-Request-Headers': 'content-type',
        },
      });

    const response = await preflight('/api/system/auth/login', 'POST');
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://web.example.com');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('access-control-allow-methods')).toBe('POST');
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type');
    expect(response.headers.get('vary')).toBe('Origin, Access-Control-Request-Method');
    expect((await preflight('/api/system/auth/login', 'DELETE')).status).toBe(404);
    expect((await preflight('/api/task/queue', 'GET')).status).toBe(404);

    const rejected = await fetch(origin + '/api/system/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.has('access-control-allow-origin')).toBe(false);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('flushes SSE before completion and aborts upstream on client disconnect', async () => {
    let reportClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      reportClosed = resolve;
    });
    const origin = await gateway((request, response) => {
      request.resume();
      response.once('close', reportClosed);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: first\n\n');
    });
    const abort = new AbortController();
    const response = await fetch(origin + '/api/chat/send', {
      method: 'POST',
      body: '{}',
      signal: abort.signal,
    });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n');
    abort.abort();
    await closed;
  });

  it('rejects private and unregistered routes before contacting upstream', async () => {
    const upstream = vi.fn<RequestListener>();
    const origin = await gateway(upstream);
    expect((await fetch(origin + '/api/file/batch-detail', { method: 'POST' })).status).toBe(404);
    expect((await fetch(origin + '/api/task/queue')).status).toBe(404);
    expect((await fetch(origin + '/api/knowledge/ingest', { method: 'POST' })).status).toBe(404);
    expect((await fetch(origin + '/api/file/%64etail')).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('exposes only the common runtime dictionary namespace through the gateway', async () => {
    const upstream = vi.fn<RequestListener>((_request, response) => response.end());
    const origin = await gateway(upstream);
    const path = origin + '/api/system/dictionaries/runtime';
    for (const query of [
      'aggregateKey=theme',
      'namespace=system',
      'namespace=common&namespace=common',
    ]) {
      expect((await fetch(`${path}?${query}`)).status).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();

    expect((await fetch(`${path}?namespace=common&aggregateKey=enabled-state`)).status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });
});

describe('gateway upstream discovery', () => {
  it('uses the instance origin, skips expired leases, and expires stale snapshots', () => {
    config.set('GatewayUpstreamMode', 'registry');
    config.set('GatewayRegistrySnapshotMs', 45_000);
    config.set('GatewayRegistryLeaseMs', GATEWAY_DEFAULTS.leaseMs);
    for (const key of ['GatewaySystemUrl', 'GatewayMiddlewareUrl', 'GatewayRagUrl']) {
      config.set(key, 'http://127.0.0.1:3100');
    }
    const now = 300_000;
    const instance: ServiceInstance = {
      id: 'system-1',
      name: UPSTREAM.system,
      host: '127.0.0.1',
      port: 3200,
      lastHeartbeat: now - 180_000,
      baseUrl: 'https://gateway.example.com/api',
    };
    const registry = {
      getLastSyncAt: () => now,
      getInstances: () => [
        { ...instance, port: 3210, lastHeartbeat: now - 180_001 },
        instance,
        { ...instance, id: 'system-2', port: 3220 },
      ],
    } as unknown as RegistryClientService;
    const upstreams = new GatewayUpstreamService(registry);
    expect(upstreams.select(UPSTREAM.system, now)?.address.origin).toBe('http://127.0.0.1:3200');
    expect(upstreams.select(UPSTREAM.system, now)?.address.origin).toBe('http://127.0.0.1:3220');
    expect(upstreams.select(UPSTREAM.file, now)).toBeUndefined();
    expect(upstreams.isReady(now + 45_001)).toBe(false);
    expect(upstreams.select(UPSTREAM.system, now + 45_001)).toBeUndefined();
  });
});
