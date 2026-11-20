export type TaskQueueDefinition = {
  taskName: string;
  queueName: string;
};

export type TaskRecord = {
  id?: string;
  name: string;
  queueName: string;
  data: unknown;
  state?: string;
  attemptsMade: number;
  timestamp: number;
  delay: number;
};

export type TaskRemoveResult = {
  id: string;
  removed: boolean;
  queueName?: string;
};

/** 附件描述生成任务数据 */
export type AttachmentDescriptionJobData = {
  fileId: number;
  fileUrl: string;
  mimeType: string;
  fileName: string;
};

/** 附件向量化完成任务数据（描述生成后触发） */
export type AttachmentVectorizeCompleteJobData = {
  fileId: number;
  fileUrl: string;
  mimeType: string;
  fileName: string;
  description: string;
};

/** 附件删除向量化任务数据 */
export type AttachmentDeletionJobData = {
  fileId: number;
  fileUrl: string;
};
