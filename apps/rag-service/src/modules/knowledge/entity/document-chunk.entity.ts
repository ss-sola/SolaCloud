import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Index } from 'typeorm';

@Entity('rag_document_chunk')
export class DocumentChunk extends BaseEntity {
  @Index()
  @Column({ name: 'document_id', type: 'int' })
  documentId!: number;

  @Index()
  @Column({ name: 'knowledge_base_id', type: 'int', nullable: true })
  knowledgeBaseId!: number | null;

  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Index('idx_rag_chunk_embedding', { spatial: true })
  @Column({
    type: 'vector',
    nullable: true,
  })
  embedding!: number[] | null;

  @Column({ name: 'token_count', type: 'int', nullable: true })
  tokenCount!: number | null;
}
