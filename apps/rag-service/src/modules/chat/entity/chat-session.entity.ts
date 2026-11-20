import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity } from 'typeorm';

@Entity('rag_chat_session')
export class ChatSession extends BaseEntity {
  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ name: 'knowledge_base_id', type: 'int', nullable: true })
  knowledgeBaseId!: number | null;
}
