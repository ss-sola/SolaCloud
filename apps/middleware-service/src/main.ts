import { bootstrap } from '@nest-cloud/sdk';
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { static as serveStatic } from 'express';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { MiddlewareConfigKeys } from './config-keys';
import { TaskQueueService } from './modules/task/service/task-queue.service';
import { MiddlewareConfigUtil } from './utils/middleware-config.util';
import { MiddlewareServiceConfig } from './validate.config';
import { DEFAULT_UPLOAD_PUBLIC_BASE_URL, DEFAULT_UPLOAD_ROOT_DIR } from './modules/file/file.constants';

void bootstrap({
  AppModule,
  validateConfig: MiddlewareServiceConfig,
  configureApp: (app) => {
    const uploadRoot = MiddlewareConfigUtil.getString(
      MiddlewareConfigKeys.UploadRootDir,
      DEFAULT_UPLOAD_ROOT_DIR,
    );
    app.use(DEFAULT_UPLOAD_PUBLIC_BASE_URL, serveStatic(resolve(uploadRoot), {
      index: false,
      redirect: false,
    }));

    const bullBoardEnabled = MiddlewareConfigUtil.getBoolean(
      MiddlewareConfigKeys.BullBoardEnabled,
      false,
    );
    if (!bullBoardEnabled) return;

    const serverAdapter = new ExpressAdapter();
    const route = MiddlewareConfigUtil.getString(
      MiddlewareConfigKeys.BullBoardRoute,
      '/admin/queues',
    );
    serverAdapter.setBasePath(route);
    const taskQueueService = app.get(TaskQueueService);
    createBullBoard({
      queues: taskQueueService.getQueues().map((queue) => new BullMQAdapter(queue)),
      serverAdapter,
    });
    app.use(route, serverAdapter.getRouter());
  },
});
