import { bootstrap } from '@nest-cloud/sdk';
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { AppModule } from './app.module';
import { MiddlewareConfigKeys } from './config-keys';
import { TaskQueueService } from './modules/task/service/task-queue.service';
import { MiddlewareConfigUtil } from './utils/middleware-config.util';
import { MiddlewareServiceConfig } from './validate.config';

void bootstrap({
  AppModule,
  validateConfig: MiddlewareServiceConfig,
  configureApp: (app) => {
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
