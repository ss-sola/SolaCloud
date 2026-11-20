import { bootstrap } from '@nest-cloud/sdk';
import { AppModule } from './app.module';
import { RagServiceConfig } from './validate.config';

void bootstrap({
  AppModule,
  validateConfig: RagServiceConfig,
});
