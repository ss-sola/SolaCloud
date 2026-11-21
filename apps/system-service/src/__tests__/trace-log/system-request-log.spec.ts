import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { SystemRequestLog } from '@/modules/trace-log/system-request-log.middleware';

describe('SystemRequestLog', () => {
  it('logs only completed success routes with the request context and route template', () => {
    const context = new AsyncLocalStorage<string>();
    const write = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {
      expect(context.getStore()).toBe('request-trace');
    });
    try {
      const request = {
        method: 'GET',
        route: { path: '/api/system/accounts/:id' },
        originalUrl: '/api/system/accounts/123?value=private',
      } as Request;
      const response = Object.assign(new EventEmitter(), { statusCode: 200 });
      const next = vi.fn();
      context.run('request-trace', () =>
        SystemRequestLog.observe(request, response as unknown as Response, next),
      );
      expect(next).toHaveBeenCalledOnce();
      expect(write).not.toHaveBeenCalled();
      response.emit('finish');
      response.emit('finish');

      const error = Object.assign(new EventEmitter(), { statusCode: 401 });
      SystemRequestLog.observe(request, error as unknown as Response, next);
      error.emit('finish');

      expect(write).toHaveBeenCalledExactlyOnceWith({
        method: 'GET',
        path: '/api/system/accounts/:id',
        status: 200,
        startedAtMs: expect.any(Number),
        durationMs: expect.any(Number),
      });
    } finally {
      write.mockRestore();
    }
  });
});
