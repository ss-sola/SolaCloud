import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity } from 'typeorm';

/**
 * Deep Agent 命名空间实体。
 * 用于隔离不同业务线或租户的 Agent 运行时数据。
 */
@Entity('deep_agent_namespace')
export class DeepAgentNamespace extends BaseEntity {
  /** 命名空间唯一标识 */
  @Column({ name: 'namespace_code', type: 'varchar', length: 128, unique: true })
  namespaceCode!: string;

  /** 命名空间显示名称 */
  @Column({ name: 'display_name', type: 'varchar', length: 255, nullable: true })
  displayName!: string | null;

  /** 命名空间描述 */
  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;
}
