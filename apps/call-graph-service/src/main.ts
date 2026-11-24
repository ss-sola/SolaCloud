import { bootstrap } from '@nest-cloud/sdk';
import { AppModule } from './app.module';
import { CallGraphConfig } from './validate.config';

void bootstrap({
  AppModule,
  validateConfig: CallGraphConfig,
  http: { cors: false },
  configureApp: (app) => {
    app.enableShutdownHooks();
  },
});
