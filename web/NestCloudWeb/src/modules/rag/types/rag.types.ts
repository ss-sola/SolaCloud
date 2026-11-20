/** SSE 事件类型 */
export interface SseEvent {
  type: 'token' | 'sources' | 'done' | 'error';
  content?: string | SourceReference[];
}

/** 引用来源 */
export interface SourceReference {
  chunkId: number;
  documentId: number;
  fileId: number | null;
  fileName: string;
  fileUrl: string | null;
  mimeType?: string;
  extension?: string;
  isExtracted?: boolean;
  previewUrl?: string;
  score: number;
}

/** 聊天消息 */
export interface ChatMessage {
  id: number;
  sessionId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: SourceReference[];
  tokenUsage?: { prompt: number; completion: number; total: number };
  createdAt: string;
  /** 附件元数据（文件上传时存储） */
  attachments?: FileAttachment[];
}

/** 聊天消息附件 */
export interface FileAttachment {
  fileId: number;
  name: string;
  size: number;
  mimeType: string;
  url: string;
}

/** 发送给后端的聊天附件表单 */
export interface ChatAttachmentForm {
  fileId: number;
  fileUrl: string;
  originalName: string;
  mimeType: string;
  size: number;
}

/** 聊天会话 */
export interface ChatSession {
  id: number;
  title: string | null;
  knowledgeBaseId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** 知识库 */
export interface KnowledgeBase {
  id: number;
  name: string;
  description: string | null;
  embeddingModel: string;
  embeddingDimension: number;
  status: string;
  createdAt: string;
}

/** 知识文档 */
export interface KnowledgeDocument {
  id: number;
  knowledgeBaseId: number;
  fileName: string;
  fileType: string;
  mimeType: string | null;
  fileUrl: string | null;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  chunkCount: number;
  errorMessage: string | null;
  createdAt: string;
}

/** 附件输入 */
export interface AttachmentInput {
  fileId?: number;
  fileName: string;
  mimeType: string;
  filePath: string;
  fileUrl?: string;
}

/** 相似问答推荐 */
export interface SimilarQueryRecommendation {
  messageId: number;
  content: string;
  assistantReply: string;
}
