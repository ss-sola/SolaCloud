import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Index } from 'typeorm';
import { PROCESSING_STATUS, ProcessingStatus } from '../knowledge.constants';

@Entity('rag_knowledge_document')
export class KnowledgeDocument extends BaseEntity {
  @Column({ name: 'knowledge_base_id', type: 'int', default: 0 })
  knowledgeBaseId!: number;

  @Column({ name: 'file_id', type: 'int', nullable: true })
  fileId!: number | null;

  @Index()
  @Column({
    name: 'processing_status',
    type: 'varchar',
    length: 32,
    default: PROCESSING_STATUS.Pending,
  })
  processingStatus!: ProcessingStatus;

  @Column({ name: 'chunk_count', type: 'int', default: 0 })
  chunkCount!: number;

  @Column({ name: 'processed_chunks', type: 'int', default: 0 })
  processedChunks!: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}
