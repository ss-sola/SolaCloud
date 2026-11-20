import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Index } from 'typeorm';
import { ChatRole } from '../chat.constants';

/** 聊天消息附件元数据 */
export interface ChatMessageAttachment {
  fileId: number;
  originalName: string;
  mimeType: string;
  size: number;
  fileUrl?: string | null;
}

@Entity('rag_chat_message')
export class ChatMessage extends BaseEntity {
  @Index()
  @Column({ name: 'session_id', type: 'int' })
  sessionId!: number;

  @Column({ type: 'varchar', length: 16 })
  role!: ChatRole;

  @Column({ type: 'text' })
  content!: string;

  /** 附件元数据（文件上传时存储） */
  @Column({ name: 'attachments', type: 'jsonb', nullable: true })
  attachments!: ChatMessageAttachment[] | null;

  @Index('idx_rag_chat_msg_query_embedding', { spatial: true })
  @Column({ name: 'query_embedding', type: 'vector', nullable: true })
  queryEmbedding!: number[] | null;

  @Column({ type: 'jsonb', nullable: true })
  sources!: Record<string, unknown>[] | null;

  @Column({ name: 'token_usage', type: 'jsonb', nullable: true })
  tokenUsage!: Record<string, number> | null;
}
