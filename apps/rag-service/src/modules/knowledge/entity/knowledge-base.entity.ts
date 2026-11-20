import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity } from 'typeorm';
import { KNOWLEDGE_BASE_STATUS, KnowledgeBaseStatus } from '../knowledge.constants';

@Entity('rag_knowledge_base')
export class KnowledgeBase extends BaseEntity {
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    name: 'embedding_model',
    type: 'varchar',
    length: 64,
    default: 'text-embedding-3-small',
  })
  embeddingModel!: string;

  @Column({
    name: 'embedding_dimension',
    type: 'int',
    default: 1536,
  })
  embeddingDimension!: number;

  @Column({
    type: 'varchar',
    length: 32,
    default: KNOWLEDGE_BASE_STATUS.Active,
  })
  status!: KnowledgeBaseStatus;
}
