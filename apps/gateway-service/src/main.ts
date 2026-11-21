import { bootstrap } from '@nest-cloud/sdk';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { GatewayProxyService } from './modules/proxy/gateway-proxy.service';
import { GatewayConfig } from './validate.config';

void bootstrap({
  AppModule,
  validateConfig: GatewayConfig,
  http: { bodyParser: false, cors: false, session: false },
  configureApp: (app) => {
    const proxy = app.get(GatewayProxyService);
    app.enableShutdownHooks();
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (/^\/api(?:[/?]|$)/.test(request.originalUrl)) proxy.forward(request, response);
      else next();
    });
  },
});
