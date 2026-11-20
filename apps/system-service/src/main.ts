import { bootstrap } from '@nest-cloud/sdk';
import { AppModule } from './app.module';
import { SystemServiceConfig } from './validate.config';

void bootstrap({
  AppModule,
  validateConfig: SystemServiceConfig,
  // skipCurrentAccountMiddleware: true, // system-service 使用自己的 CurrentAccountMiddleware
});
