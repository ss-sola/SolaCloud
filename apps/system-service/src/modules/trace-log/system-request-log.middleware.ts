import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

export class SystemRequestLog {
  private static readonly logger = new Logger(SystemRequestLog.name);

  static observe(request: Request, response: Response, next: NextFunction): void {
    const startedAtMs = Date.now();
    const startedAt = performance.now();

    // Preserve the SDK's trace context until Express has sent the actual status.
    response.once(
      'finish',
      AsyncLocalStorage.bind(() => {
        const path = request.route?.path;
        if (typeof path !== 'string' || response.statusCode < 200 || response.statusCode >= 300) {
          return;
        }

        SystemRequestLog.logger.log({
          method: request.method,
          path,
          status: response.statusCode,
          startedAtMs,
          durationMs: Math.round(performance.now() - startedAt),
        });
      }),
    );
    next();
  }
}
