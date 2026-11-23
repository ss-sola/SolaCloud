import { HttpTraceLog } from '@solacloud/http-trace-log';
import { Logger } from '@nestjs/common';
import { AppLogger, bootstrap } from '@nest-cloud/sdk';
import { AppModule } from './app.module';
import { RagServiceConfig } from './validate.config';

HttpTraceLog.installSdkLogPolicy(AppLogger);

void bootstrap({
  AppModule,
  validateConfig: RagServiceConfig,
  configureApp: (app) => {
    app.use(HttpTraceLog.observe(new Logger('ServiceRequestLog')));
  },
});
