/** RAG 服务常量 */

/** 默认向量维度 */
export const DEFAULT_EMBEDDING_DIMENSION = 1536;

/** 默认 Embedding 模型 */
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/** 默认 LLM 模型 */
export const DEFAULT_LLM_MODEL = 'gpt-4o';

/** 默认多模态模型 */
export const DEFAULT_MULTIMODAL_MODEL = 'gpt-4o';

/** LLM 调用超时时间（毫秒） */
export const DEFAULT_LLM_TIMEOUT = 60_000;

/** 默认分片大小（字符数） */
export const DEFAULT_CHUNK_SIZE = 1000;

/** 默认分片重叠（字符数） */
export const DEFAULT_CHUNK_OVERLAP = 200;

/** 默认检索 Top K */
export const DEFAULT_RETRIEVAL_TOP_K = 5;

/** 默认相似度阈值 */
export const DEFAULT_RETRIEVAL_SCORE_THRESHOLD = 0.7;

/** 聊天上下文压缩阈值（消息条数，达到此数量触发摘要） */
export const CHAT_COMPRESS_THRESHOLD = 20;

/** 聊天上下文压缩保留条数（摘要时保留最近 N 条完整消息） */
export const CHAT_KEEP_COUNT = 10;

/** 文件类型分类 */
export const FILE_TYPE_CATEGORY = {
  Document: 'document',
  Image: 'image',
  Audio: 'audio',
  Video: 'video',
} as const;

export type FileTypeCategory = (typeof FILE_TYPE_CATEGORY)[keyof typeof FILE_TYPE_CATEGORY];

/** 文档处理状态 */
export const PROCESSING_STATUS = {
  Pending: 'pending',
  Processing: 'processing',
  Completed: 'completed',
  Failed: 'failed',
} as const;

export type ProcessingStatus = (typeof PROCESSING_STATUS)[keyof typeof PROCESSING_STATUS];

/** 知识库状态 */
export const KNOWLEDGE_BASE_STATUS = {
  Active: 'active',
  Archived: 'archived',
} as const;

export type KnowledgeBaseStatus =
  (typeof KNOWLEDGE_BASE_STATUS)[keyof typeof KNOWLEDGE_BASE_STATUS];

/** 聊天角色 */
export const CHAT_ROLE = {
  User: 'user',
  Assistant: 'assistant',
  System: 'system',
} as const;

export type ChatRole = (typeof CHAT_ROLE)[keyof typeof CHAT_ROLE];

/** SSE 事件类型 */
export const SSE_EVENT_TYPE = {
  Token: 'token',
  Sources: 'sources',
  Done: 'done',
  Error: 'error',
} as const;

/** MIME 类型到文件类型分类映射 */
export const MIME_TO_FILE_TYPE: Record<string, FileTypeCategory> = {
  'application/pdf': FILE_TYPE_CATEGORY.Document,
  'application/msword': FILE_TYPE_CATEGORY.Document,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    FILE_TYPE_CATEGORY.Document,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    FILE_TYPE_CATEGORY.Document,
  'application/vnd.ms-powerpoint': FILE_TYPE_CATEGORY.Document,
  'application/vnd.ms-excel': FILE_TYPE_CATEGORY.Document,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FILE_TYPE_CATEGORY.Document,
  'text/plain': FILE_TYPE_CATEGORY.Document,
  'text/markdown': FILE_TYPE_CATEGORY.Document,
  'text/csv': FILE_TYPE_CATEGORY.Document,
  'application/csv': FILE_TYPE_CATEGORY.Document,
  'image/jpeg': FILE_TYPE_CATEGORY.Image,
  'image/png': FILE_TYPE_CATEGORY.Image,
  'image/gif': FILE_TYPE_CATEGORY.Image,
  'image/webp': FILE_TYPE_CATEGORY.Image,
  'image/bmp': FILE_TYPE_CATEGORY.Image,
  'audio/mpeg': FILE_TYPE_CATEGORY.Audio,
  'audio/wav': FILE_TYPE_CATEGORY.Audio,
  'audio/ogg': FILE_TYPE_CATEGORY.Audio,
  'audio/mp4': FILE_TYPE_CATEGORY.Audio,
  'video/mp4': FILE_TYPE_CATEGORY.Video,
  'video/webm': FILE_TYPE_CATEGORY.Video,
  'video/ogg': FILE_TYPE_CATEGORY.Video,
  'video/quicktime': FILE_TYPE_CATEGORY.Video,
};
/** 队列任务内按文件派生描述回写操作键，保证重投时识别同一步写入。 */
export const FILE_DESCRIPTION_WRITE_STEP = 'update-file-description';
