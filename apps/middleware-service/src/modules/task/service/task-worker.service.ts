import { AfterApplicationBootstrap, ContextService } from '@nest-cloud/sdk';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'bullmq';
import { createHash } from 'node:crypto';
import { MiddlewareConfigKeys } from '../../../config-keys';
import { MiddlewareConfigUtil } from '../../../utils/middleware-config.util';
import { RagServiceClient } from '../../../client/rag-service.client';
import {
  DEFAULT_QUEUE_CLEANUP_CRON,
  DEFAULT_QUEUE_DEFAULT_CONCURRENCY,
  TASK_UPLOAD_CLEANUP_JOB_NAME,
  TASK_UPLOAD_CLEANUP_QUEUE_NAME,
  ATTACHMENT_VECTORIZE_JOB_NAME,
  ATTACHMENT_VECTORIZE_QUEUE_NAME,
  ATTACHMENT_VECTORIZE_COMPLETE_JOB_NAME,
  ATTACHMENT_VECTORIZE_COMPLETE_QUEUE_NAME,
} from '../task.constants';
import { TaskQueueService } from './task-queue.service';
import { DEFAULT_UPLOAD_TEMP_TTL_MS } from '../../file/file.constants';
import { FileService } from '../../file/service/file.service';
import { FileUploadSessionService } from '../../file/service/file-upload-session.service';

/**
 * 创建带上下文恢复的 worker 处理器。
 * 将 job data 中的 _headers 注入到 ContextService.setStore，
 * 使 RemoteClientBase 能正常获取 header 透传给下游服务。
 */
function createWorkerHandler(fn: (job: any) => Promise<unknown>): (job: any) => Promise<unknown> {
  return async (job) => {
    const headers = job.data?._headers as Record<string, string> | undefined;
    const fakeReq = { headers: headers ?? {} } as any;
    return ContextService.setStore({ req: fakeReq, res: {} as any }, () => fn(job));
  };
}

@Injectable()
export class TaskWorkerService implements AfterApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TaskWorkerService.name);
  private readonly workers: Worker[] = [];

  constructor(
    private readonly taskQueueService: TaskQueueService,
    private readonly fileService: FileService,
    private readonly fileUploadSessionService: FileUploadSessionService,
    private readonly ragServiceClient: RagServiceClient,
  ) {}

  async afterApplicationBootstrap() {
    await this.taskQueueService.addRepeatableJob(
      TASK_UPLOAD_CLEANUP_JOB_NAME,
      {
        ttlMs: MiddlewareConfigUtil.getNumber(
          MiddlewareConfigKeys.UploadTempTtlMs,
          DEFAULT_UPLOAD_TEMP_TTL_MS,
        ),
      },
      MiddlewareConfigUtil.getString(
        MiddlewareConfigKeys.QueueCleanupCron,
        DEFAULT_QUEUE_CLEANUP_CRON,
      ),
    );
    this.createUploadCleanupWorker(
      MiddlewareConfigUtil.getNumber(
        MiddlewareConfigKeys.QueueDefaultConcurrency,
        DEFAULT_QUEUE_DEFAULT_CONCURRENCY,
      ),
    );
    this.createVectorizeWorker(
      MiddlewareConfigUtil.getNumber(MiddlewareConfigKeys.AttachmentVectorizeConcurrency, 5),
    );
    this.createDescriptionCompleteWorker(
      MiddlewareConfigUtil.getNumber(MiddlewareConfigKeys.AttachmentVectorizeConcurrency, 5),
    );
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.taskQueueService.close();
  }

  private createUploadCleanupWorker(concurrency: number) {
    const worker = new Worker(
      TASK_UPLOAD_CLEANUP_QUEUE_NAME,
      createWorkerHandler(async () => ({
        files: this.fileService.cleanupExpiredTemporaryFiles(),
        sessions: this.fileUploadSessionService.cleanupExpiredUploadSessions(),
      })),
      {
        connection: this.taskQueueService.getConnection(),
        prefix: this.taskQueueService.getPrefix(),
        concurrency,
      },
    );

    worker.on('failed', (job, error) => {
      this.logger.error(
        `Task failed: queue=${TASK_UPLOAD_CLEANUP_QUEUE_NAME} job=${job?.name ?? 'unknown'} - ${error.message}`,
        error.stack,
      );
    });

    this.workers.push(worker);
  }

  private createVectorizeWorker(concurrency: number) {
    const worker = new Worker(
      ATTACHMENT_VECTORIZE_QUEUE_NAME,
      createWorkerHandler(async (job) => {
        const data = job.data as {
          fileId: number;
          fileUrl: string;
          mimeType: string;
          fileName: string;
        };
        // BullMQ 保留 job 创建时间和 ID。重投沿用同一步骤身份，新 job 产生新身份。
        const operationKey = createHash('sha256')
          .update(JSON.stringify([job.queueQualifiedName, job.id, job.timestamp, job.name]))
          .digest('hex');
        const result = await ContextService.withOperationKey(operationKey, () =>
          this.ragServiceClient.describeAttachment({
            fileId: data.fileId,
            fileUrl: data.fileUrl,
            mimeType: data.mimeType,
            fileName: data.fileName,
          }),
        );
        // 描述生成成功后，触发向量化
        if (result.data) {
          await this.taskQueueService.addJob(ATTACHMENT_VECTORIZE_COMPLETE_JOB_NAME, {
            fileId: data.fileId,
            fileUrl: data.fileUrl,
            mimeType: data.mimeType,
            fileName: data.fileName,
            description: result.data,
          });
        }
        return result;
      }),
      {
        connection: this.taskQueueService.getConnection(),
        prefix: this.taskQueueService.getPrefix(),
        concurrency,
      },
    );

    worker.on('failed', (job, error) => {
      this.logger.error(
        `Task failed: queue=${ATTACHMENT_VECTORIZE_QUEUE_NAME} job=${job?.name ?? 'unknown'} - ${error.message}`,
        error.stack,
      );
    });

    this.workers.push(worker);
  }

  private createDescriptionCompleteWorker(concurrency: number) {
    const worker = new Worker(
      ATTACHMENT_VECTORIZE_COMPLETE_QUEUE_NAME,
      createWorkerHandler(async (job) => {
        const data = job.data as {
          fileId: number;
          fileUrl: string;
          mimeType: string;
          fileName: string;
          description: string;
        };
        return this.ragServiceClient.autoVectorize({
          fileId: data.fileId,
          fileUrl: data.fileUrl,
          mimeType: data.mimeType,
          fileName: data.fileName,
          description: data.description,
        });
      }),
      {
        connection: this.taskQueueService.getConnection(),
        prefix: this.taskQueueService.getPrefix(),
        concurrency,
      },
    );

    worker.on('failed', (job, error) => {
      this.logger.error(
        `Task failed: queue=${ATTACHMENT_VECTORIZE_COMPLETE_QUEUE_NAME} job=${job?.name ?? 'unknown'} - ${error.message}`,
        error.stack,
      );
    });

    this.workers.push(worker);
  }
}
