import { ContextService, ProjectException } from '@nest-cloud/sdk';
import { Injectable } from '@nestjs/common';
import { Job, JobsOptions, Queue, QueueOptions } from 'bullmq';
import Redis from 'ioredis';
import { MiddlewareConfigKeys } from '../../../config-keys';
import { MiddlewareConfigUtil } from '../../../utils/middleware-config.util';
import {
  DEFAULT_QUEUE_DEFAULT_ATTEMPTS,
  DEFAULT_QUEUE_DEFAULT_BACKOFF_MS,
  DEFAULT_QUEUE_PREFIX,
  TASK_QUEUE_DEFINITIONS,
} from '../task.constants';
import { TaskQueueDefinition, TaskRecord, TaskRemoveResult } from '../task.types';

/** 不需要透传到远程服务的 header */
const STRIP_HEADERS = new Set([
  'host',
  'content-length',
  'traceparent',
  'tracestate',
  'x-operation-id',
  'idempotency-key',
]);

/** 从当前请求上下文提取需要透传的 header */
function captureRequestHeaders(): Record<string, string> | undefined {
  try {
    const req = ContextService.getReq();
    if (!req?.headers) return undefined;
    const result = ContextService.getTraceHeaders();
    for (const [key, value] of Object.entries(req.headers)) {
      if (!STRIP_HEADERS.has(key.toLowerCase()) && value) {
        result[key] = Array.isArray(value) ? value[0] : value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    // 没有请求上下文时返回 undefined（如定时任务、worker 内部调用）
    return undefined;
  }
}

@Injectable()
export class TaskQueueService {
  private readonly redis: Redis;
  private readonly queues = new Map<string, Queue>();

  constructor() {
    const prefix = this.getPrefix();
    this.redis = this.createRedisConnection();
    const options: QueueOptions = {
      connection: this.redis,
      prefix,
    };
    for (const definition of TASK_QUEUE_DEFINITIONS) {
      this.queues.set(definition.taskName, new Queue(definition.queueName, options));
    }
  }

  getQueue(taskName: string) {
    return this.getRequiredQueue(taskName);
  }

  getQueues() {
    return [...this.queues.values()];
  }

  getQueueDefinitions(): TaskQueueDefinition[] {
    return TASK_QUEUE_DEFINITIONS.map((definition) => ({ ...definition }));
  }

  getConnection() {
    return this.redis;
  }

  getPrefix() {
    return MiddlewareConfigUtil.getString(MiddlewareConfigKeys.QueuePrefix, DEFAULT_QUEUE_PREFIX);
  }

  async addJob<T = Record<string, unknown>>(name: string, data?: T, delayMs = 0) {
    const queue = this.getRequiredQueue(name);
    const jobsOptions: JobsOptions = {
      attempts: MiddlewareConfigUtil.getNumber(
        MiddlewareConfigKeys.QueueDefaultAttempts,
        DEFAULT_QUEUE_DEFAULT_ATTEMPTS,
      ),
      backoff: {
        type: 'exponential',
        delay: MiddlewareConfigUtil.getNumber(
          MiddlewareConfigKeys.QueueDefaultBackoffMs,
          DEFAULT_QUEUE_DEFAULT_BACKOFF_MS,
        ),
      },
      delay: delayMs,
      removeOnComplete: true,
      removeOnFail: false,
    };
    // 自动捕获当前请求的 header 存入 data，供 worker 恢复上下文
    const headers = captureRequestHeaders();
    const enrichedData = headers
      ? { ...(data as Record<string, unknown>), _headers: headers }
      : data;
    return this.toRecord(await queue.add(name, enrichedData ?? {}, jobsOptions), queue.name);
  }

  async addRepeatableJob<T = Record<string, unknown>>(name: string, data: T, pattern: string) {
    const queue = this.getRequiredQueue(name);
    // 自动捕获当前请求的 header 存入 data，供 worker 恢复上下文
    const headers = captureRequestHeaders();
    const enrichedData = headers
      ? { ...(data as Record<string, unknown>), _headers: headers }
      : data;
    // BullMQ 5 schedules live in the same set. Reuse the existing key when
    // migrating so the previously delayed cleanup job is replaced in place.
    const existing = (await queue.getJobSchedulers()).find((scheduler) => scheduler.name === name);
    const job = await queue.upsertJobScheduler(existing?.key ?? name, { pattern }, {
      name,
      data: enrichedData,
      opts: { removeOnComplete: true, removeOnFail: false },
    });
    return this.toRecord(job, queue.name);
  }

  async getJob(id: string, name?: string) {
    const entries = this.getQueueEntries(name);
    for (const [, queue] of entries) {
      const job = await queue.getJob(id);
      if (job) return this.toRecord(job, queue.name);
    }
    return undefined;
  }

  async removeJob(id: string, name?: string): Promise<TaskRemoveResult> {
    const entries = this.getQueueEntries(name);
    for (const [, queue] of entries) {
      const job = await queue.getJob(id);
      if (job) {
        await job.remove();
        return {
          id,
          removed: true,
          queueName: queue.name,
        };
      }
    }
    return {
      id,
      removed: false,
    };
  }

  async close() {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    await this.redis.quit();
  }

  private createRedisConnection() {
    return new Redis(MiddlewareConfigUtil.getString(MiddlewareConfigKeys.QueueRedisUrl, ''), {
      lazyConnect: false,
      maxRetriesPerRequest: null,
    });
  }

  private getRequiredQueue(taskName: string) {
    const queue = this.queues.get(taskName);
    if (!queue) {
      throw new ProjectException(`不支持的任务类型：${taskName}`, 400);
    }
    return queue;
  }

  private getQueueEntries(name?: string) {
    if (name) return [[name, this.getRequiredQueue(name)] as const];
    return [...this.queues.entries()];
  }

  private async toRecord(job: Job, queueName: string): Promise<TaskRecord> {
    return {
      id: job.id,
      name: job.name,
      queueName,
      data: job.data,
      state: await job.getState(),
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      delay: job.delay,
    };
  }
}
