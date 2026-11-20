import { describe, it, expect, vi, beforeEach } from 'vitest';
const { MockWorker, mockWorkerInstances } = vi.hoisted(() => {
  const instances: any[] = [];

  class MockWorker {
    name: string;
    processor: () => Promise<unknown> | unknown;
    options: unknown;
    on = vi.fn();
    close = vi.fn();

    constructor(name: string, processor: () => Promise<unknown> | unknown, options: unknown) {
      this.name = name;
      this.processor = processor;
      this.options = options;
      instances.push(this);
    }
  }

  return { MockWorker, mockWorkerInstances: instances };
});

vi.mock('bullmq', () => ({
  Worker: MockWorker,
}));

import { TaskWorkerService } from '../modules/task/service/task-worker.service';
import {
  TASK_UPLOAD_CLEANUP_JOB_NAME,
  TASK_UPLOAD_CLEANUP_QUEUE_NAME,
  ATTACHMENT_VECTORIZE_JOB_NAME,
  ATTACHMENT_VECTORIZE_QUEUE_NAME,
  ATTACHMENT_VECTORIZE_COMPLETE_JOB_NAME,
  ATTACHMENT_VECTORIZE_COMPLETE_QUEUE_NAME,
} from '../modules/task/task.constants';

describe('TaskWorkerService', () => {
  beforeEach(() => {
    mockWorkerInstances.length = 0;
  });

  it('creates upload cleanup worker and schedules repeatable job', async () => {
    const queueService = {
      getConnection: vi.fn().mockReturnValue({}),
      getPrefix: vi.fn().mockReturnValue('middleware'),
      addRepeatableJob: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
    };
    const fileService = {
      cleanupExpiredTemporaryFiles: vi.fn().mockResolvedValue({ removed: 1 }),
    };
    const fileUploadSessionService = {
      cleanupExpiredUploadSessions: vi.fn().mockResolvedValue({ removed: 2 }),
    };
    const ragServiceClient = {
      describeAttachment: vi.fn().mockResolvedValue({ data: true }),
      deleteByFile: vi.fn().mockResolvedValue({ data: true }),
    };
    const service = new TaskWorkerService(
      queueService as any,
      fileService as any,
      fileUploadSessionService as any,
      ragServiceClient as any,
    );

    await service.afterApplicationBootstrap();

    expect(mockWorkerInstances).toHaveLength(3);
    expect(mockWorkerInstances[0].name).toBe(TASK_UPLOAD_CLEANUP_QUEUE_NAME);
    expect(mockWorkerInstances[1].name).toBe(ATTACHMENT_VECTORIZE_QUEUE_NAME);
    expect(mockWorkerInstances[2].name).toBe(ATTACHMENT_VECTORIZE_COMPLETE_QUEUE_NAME);

    expect(queueService.addRepeatableJob).toHaveBeenCalledWith(
      TASK_UPLOAD_CLEANUP_JOB_NAME,
      expect.objectContaining({ ttlMs: expect.any(Number) }),
      expect.any(String),
    );
  });

  it('closes workers before queue service', async () => {
    const queueService = {
      getConnection: vi.fn().mockReturnValue({}),
      getPrefix: vi.fn().mockReturnValue('middleware'),
      addRepeatableJob: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
    };
    const fileService = {
      cleanupExpiredTemporaryFiles: vi.fn(),
    };
    const fileUploadSessionService = {
      cleanupExpiredUploadSessions: vi.fn(),
    };
    const ragServiceClient = {
      describeAttachment: vi.fn().mockResolvedValue({ data: true }),
      deleteByFile: vi.fn().mockResolvedValue({ data: true }),
    };
    const service = new TaskWorkerService(
      queueService as any,
      fileService as any,
      fileUploadSessionService as any,
      ragServiceClient as any,
    );

    await service.afterApplicationBootstrap();
    await service.onModuleDestroy();

    expect(mockWorkerInstances[0].close).toHaveBeenCalledTimes(1);
    expect(mockWorkerInstances[1].close).toHaveBeenCalledTimes(1);
    expect(mockWorkerInstances[2].close).toHaveBeenCalledTimes(1);
    expect(queueService.close).toHaveBeenCalledTimes(1);
  });
});
