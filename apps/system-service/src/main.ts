import { HttpTraceLog } from '@solacloud/http-trace-log';
import { AppLogger, bootstrap, getConfig } from '@nest-cloud/sdk';
import { isIP } from 'node:net';
import { AppModule } from './app.module';
import { SystemRequestLog } from './modules/trace-log/system-request-log.middleware';
import { SystemServiceConfig } from './validate.config';

HttpTraceLog.installSdkLogPolicy(AppLogger);

void bootstrap({
  AppModule,
  validateConfig: SystemServiceConfig,
  configureApp: (app) => {
    const trusted = getConfig<string>('TrustedProxyIps', '')
      .split(',')
      .map((address) => address.trim())
      .filter(Boolean);
    if (trusted.some((address) => !isIP(address))) {
      throw new Error('TrustedProxyIps must contain only IP addresses');
    }
    if (trusted.length) app.set('trust proxy', trusted);
    app.use(SystemRequestLog.observe);
  },
});
