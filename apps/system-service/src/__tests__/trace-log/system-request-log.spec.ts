import { AppLogger } from '@nest-cloud/sdk';
import { HttpTraceLog } from '@solacloud/http-trace-log';
import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { SystemRequestLog } from '@/modules/trace-log/system-request-log.middleware';

describe('SystemRequestLog', () => {
  it.each([200, 304, 422, 500])(
    'logs a finished %i response once with its trace context and route template',
    (statusCode) => {
      const context = new AsyncLocalStorage<string>();
      const write = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {
        expect(context.getStore()).toBe('request-trace');
      });
      try {
        const request = {
          method: 'GET',
          originalUrl: '/api/system/accounts/123?value=private',
        } as Request;
        const response = Object.assign(new EventEmitter(), { statusCode: 200 });
        const next = vi.fn();
        context.run('request-trace', () =>
          SystemRequestLog.observe(request, response as unknown as Response, next),
        );
        expect(next).toHaveBeenCalledOnce();
        expect(write).not.toHaveBeenCalled();
        request.route = { path: '/api/system/accounts/:id' };
        response.statusCode = statusCode;
        response.emit('finish');
        response.emit('finish');

        expect(write).toHaveBeenCalledExactlyOnceWith({
          method: 'GET',
          path: '/api/system/accounts/:id',
          status: statusCode,
          startedAtMs: expect.any(Number),
          durationMs: expect.any(Number),
          parentSpanId: undefined,
          httpDetails: expect.objectContaining({
            responseHeaders: { state: 'captured', value: {} },
          }),
        });
      } finally {
        write.mockRestore();
      }
    },
  );

  it('skips requests without a matched route or without a finished response', () => {
    const write = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    try {
      const unmatched = Object.assign(new EventEmitter(), { statusCode: 404 });
      SystemRequestLog.observe(
        { method: 'GET' } as Request,
        unmatched as unknown as Response,
        vi.fn(),
      );
      unmatched.emit('finish');

      const interrupted = Object.assign(new EventEmitter(), { statusCode: 200 });
      SystemRequestLog.observe(
        { method: 'GET', route: { path: '/api/system/auth/current' } } as Request,
        interrupted as unknown as Response,
        vi.fn(),
      );
      interrupted.emit('close');
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});

describe('HTTP log details', () => {
  it.each([
    ['/api/system/accounts', 200, 'captured'],
    ['/api/system/accounts', 304, 'empty'],
    ['/api/file/upload', 200, 'skipped'],
    ['/api/chat/send', 200, 'skipped'],
  ])('logs safe details for %s HTTP %i', (path, status, bodyState) => {
    const write = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    try {
      const request = {
        method: 'POST',
        originalUrl: path,
        route: { path },
        headers: {
          'content-type': 'application/json',
          cookie: 'cookie-plaintext',
          'x-example': 'ordinary',
        },
        query: { filter: 'active', access_token: 'query-plaintext' },
        body: { nested: [{ password: 'password-plaintext', name: 'ordinary' }] },
      } as unknown as Request;
      const response = Object.assign(new EventEmitter(), {
        statusCode: status,
        getHeader: () => 'application/json',
        getHeaders: () => ({ 'set-cookie': ['cookie-plaintext'] }),
        json: vi.fn(),
      });
      SystemRequestLog.observe(request, response as unknown as Response, vi.fn());
      response.json({ accessToken: 'response-plaintext', name: 'ordinary' });
      response.emit('finish');
      const record = write.mock.calls[0][0] as { httpDetails: Record<string, unknown> };
      expect(JSON.stringify(record)).not.toContain('-plaintext');
      expect(record.httpDetails).toMatchObject({
        requestHeaders: { value: { cookie: '[REDACTED]', 'x-example': 'ordinary' } },
        query: { value: { filter: 'active', access_token: '[REDACTED]' } },
        requestBody: { state: bodyState === 'skipped' ? 'skipped' : 'captured' },
        responseBody: { state: bodyState },
      });
    } finally {
      write.mockRestore();
    }
  });

  it('redacts dictionary secrets selected by query or sibling key and preserves ordinary values', () => {
    const logger = { log: vi.fn() };
    const path = '/api/system/dictionaries/item';
    const request = {
      method: 'PUT',
      originalUrl: path + '?key=apiKey',
      route: { path },
      headers: { 'content-type': 'application/json' },
      query: { namespace: 'system', aggregateKey: 'chat-llm', key: 'apiKey' },
      body: { value: 'request-plaintext', label: 'Chat API' },
    } as unknown as Request;
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      getHeader: () => 'application/json',
      json: vi.fn(),
    });
    HttpTraceLog.observe(logger)(request, response as unknown as Response, vi.fn());
    response.json({
      data: [
        { key: 'apiKey', value: 'response-plaintext' },
        { key: 'model', value: 'example-model' },
        { property: 'password', value: 'validation-plaintext' },
        { settings: '{"password":"embedded-plaintext"}' },
        { endpoint: 'https://user:url-plaintext@localhost/resource' },
      ],
    });
    response.emit('finish');
    const { httpDetails } = logger.log.mock.calls[0][0];
    expect(JSON.stringify(httpDetails)).not.toContain('-plaintext');
    expect(httpDetails.requestBody.value).toEqual({ value: '[REDACTED]', label: 'Chat API' });
    expect(httpDetails.responseBody.value.data[1]).toEqual({
      key: 'model',
      value: 'example-model',
    });
    expect(request.body.value).toBe('request-plaintext');
  });

  it('bounds individual captured sections without retaining the rest of a large value', () => {
    const write = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    try {
      const request = {
        method: 'POST',
        originalUrl: '/api/system/accounts',
        route: { path: '/api/system/accounts' },
        headers: { 'content-type': 'application/json' },
        body: { name: '测'.repeat(5000) + 'suffix-outside-preview' },
      } as unknown as Request;
      const response = Object.assign(new EventEmitter(), { statusCode: 200 });
      SystemRequestLog.observe(request, response as unknown as Response, vi.fn());
      response.emit('finish');
      const { httpDetails } = write.mock.calls[0][0];
      expect(httpDetails.requestBody.state).toBe('truncated');
      const detail = JSON.stringify(httpDetails.requestBody);
      expect(Buffer.byteLength(detail)).toBeLessThan(4096);
      expect(detail).not.toContain('suffix-outside-preview');
    } finally {
      write.mockRestore();
    }
  });
});

it('replaces the legacy raw access entry and keeps only safe exception metadata and stack frames', () => {
  const debug = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  class SdkLogger {
    debug = debug;
    warn = warn;
    error = error;
  }
  // Match the prototype methods implemented by AppLogger.
  Object.assign(SdkLogger.prototype, { debug, warn, error });
  HttpTraceLog.installSdkLogPolicy(SdkLogger as unknown as typeof AppLogger);
  SdkLogger.prototype.debug('raw URL containing query secret', 'HttpAccess');
  SdkLogger.prototype.debug('ordinary SDK message', 'RemoteClientBase');
  SdkLogger.prototype.error(
    '{"url":"/path?token=hidden","method":"GET","status":500}\n' +
      'Error: private error input\n    at Handler.run (handler.js:3:4)',
    undefined,
    'GlobalExceptionFilter',
  );
  expect(debug).toHaveBeenCalledExactlyOnceWith('ordinary SDK message', 'RemoteClientBase');
  expect(error).toHaveBeenCalledExactlyOnceWith(
    '{"method":"GET","status":500}\n    at Handler.run (handler.js:3:4)',
    undefined,
    'GlobalExceptionFilter',
  );
});
