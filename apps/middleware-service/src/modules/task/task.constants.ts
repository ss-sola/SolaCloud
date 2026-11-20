export const TASK_UPLOAD_CLEANUP_JOB_NAME = 'upload-cleanup';
export const TASK_UPLOAD_CLEANUP_QUEUE_NAME = 'middleware-task-upload-cleanup';

export const ATTACHMENT_VECTORIZE_JOB_NAME = 'attachment-vectorize';
export const ATTACHMENT_VECTORIZE_QUEUE_NAME = 'middleware-task-attachment-vectorize';

export const ATTACHMENT_VECTORIZE_COMPLETE_JOB_NAME = 'attachment-vectorize-complete';
export const ATTACHMENT_VECTORIZE_COMPLETE_QUEUE_NAME =
  'middleware-task-attachment-vectorize-complete';

export const TASK_QUEUE_DEFINITIONS = [
  {
    taskName: TASK_UPLOAD_CLEANUP_JOB_NAME,
    queueName: TASK_UPLOAD_CLEANUP_QUEUE_NAME,
  },
  {
    taskName: ATTACHMENT_VECTORIZE_JOB_NAME,
    queueName: ATTACHMENT_VECTORIZE_QUEUE_NAME,
  },
  {
    taskName: ATTACHMENT_VECTORIZE_COMPLETE_JOB_NAME,
    queueName: ATTACHMENT_VECTORIZE_COMPLETE_QUEUE_NAME,
  },
] as const;

export const DEFAULT_QUEUE_PREFIX = 'middleware';

export const DEFAULT_QUEUE_DEFAULT_CONCURRENCY = 2;

export const DEFAULT_QUEUE_DEFAULT_ATTEMPTS = 3;

export const DEFAULT_QUEUE_DEFAULT_BACKOFF_MS = 5_000;

export const DEFAULT_QUEUE_CLEANUP_CRON = '15 */1 * * *';
