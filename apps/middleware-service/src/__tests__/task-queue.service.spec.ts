import { describe, it, expect, vi, beforeEach } from 'vitest';
const { MockQueue, queueInstances, redisQuit, MockRedis } = vi.hoisted(() => {
  const queueInstances: any[] = [];
  const redisQuit = vi.fn();

  class MockQueue {
    name: string;
    add = vi.fn();
    getJob = vi.fn();
    close = vi.fn();

    constructor(name: string) {
      this.name = name;
      queueInstances.push(this);
    }
  }

  class MockRedis {
    quit = redisQuit;
  }

  return { MockQueue, queueInstances, redisQuit, MockRedis };
});

vi.mock('bullmq', () => ({
  Queue: MockQueue,
}));

vi.mock('ioredis', () => ({
  default: MockRedis,
}));

import { ProjectException } from '@nest-cloud/sdk';
import { TaskQueueService } from '../modules/task/service/task-queue.service';
import {
  TASK_UPLOAD_CLEANUP_JOB_NAME,
  TASK_UPLOAD_CLEANUP_QUEUE_NAME,
  ATTACHMENT_VECTORIZE_JOB_NAME,
  ATTACHMENT_VECTORIZE_QUEUE_NAME,
  ATTACHMENT_VECTORIZE_COMPLETE_JOB_NAME,
  ATTACHMENT_VECTORIZE_COMPLETE_QUEUE_NAME,
} from '../modules/task/task.constants';

const createJob = (id: string) => ({
  id,
  name: TASK_UPLOAD_CLEANUP_JOB_NAME,
  data: { ok: true },
  attemptsMade: 0,
  timestamp: 1,
  delay: 0,
  getState: vi.fn().mockResolvedValue('waiting'),
  remove: vi.fn(),
});

describe('TaskQueueService', () => {
  beforeEach(() => {
    queueInstances.length = 0;
    redisQuit.mockClear();
  });

  it('creates one queue for each task type', () => {
    const service = new TaskQueueService();

    expect(service.getQueues()).toHaveLength(3);
    const queueNames = service.getQueues().map((q) => q.name);
    expect(queueNames).toContain(TASK_UPLOAD_CLEANUP_QUEUE_NAME);
    expect(queueNames).toContain(ATTACHMENT_VECTORIZE_QUEUE_NAME);
    expect(queueNames).toContain(ATTACHMENT_VECTORIZE_COMPLETE_QUEUE_NAME);
  });

  it('routes jobs to task specific queue', async () => {
    const service = new TaskQueueService();
    const job = createJob('1');
    queueInstances[0].add.mockResolvedValue(job);

    const record = await service.addJob(TASK_UPLOAD_CLEANUP_JOB_NAME, {
      ok: true,
    });

    expect(queueInstances[0].add).toHaveBeenCalledWith(
      TASK_UPLOAD_CLEANUP_JOB_NAME,
      { ok: true },
      expect.objectContaining({ removeOnComplete: true }),
    );
    expect(record.queueName).toBe(TASK_UPLOAD_CLEANUP_QUEUE_NAME);
  });

  it('rejects unsupported task types', async () => {
    const service = new TaskQueueService();

    await expect(service.addJob('unknown-task', {})).rejects.toBeInstanceOf(ProjectException);
  });

  it('gets and removes jobs from task specific queue', async () => {
    const service = new TaskQueueService();
    const job = createJob('1');
    queueInstances[0].getJob.mockResolvedValue(job);

    const record = await service.getJob('1', TASK_UPLOAD_CLEANUP_JOB_NAME);
    const removeResult = await service.removeJob('1', TASK_UPLOAD_CLEANUP_JOB_NAME);

    expect(record?.queueName).toBe(TASK_UPLOAD_CLEANUP_QUEUE_NAME);
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(removeResult).toEqual({
      id: '1',
      removed: true,
      queueName: TASK_UPLOAD_CLEANUP_QUEUE_NAME,
    });
  });

  it('closes all queues and redis connection', async () => {
    const service = new TaskQueueService();

    await service.close();

    expect(queueInstances[0].close).toHaveBeenCalledTimes(1);
    expect(redisQuit).toHaveBeenCalledTimes(1);
  });
});
