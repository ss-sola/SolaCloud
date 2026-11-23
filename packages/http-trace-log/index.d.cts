import type { AppLogger } from '@nest-cloud/sdk';
import type { NextFunction, Request, Response } from 'express';

export class HttpTraceLog {
  static installSdkLogPolicy(logger: typeof AppLogger): void;
  static observe(logger: {
    log(message: object): void;
  }): (request: Request, response: Response, next: NextFunction) => void;
  static parentSpanId(request: Request): string | undefined;
  static headers(headers: ReturnType<Response['getHeaders']>): object;
}
