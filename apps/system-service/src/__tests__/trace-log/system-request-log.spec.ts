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
