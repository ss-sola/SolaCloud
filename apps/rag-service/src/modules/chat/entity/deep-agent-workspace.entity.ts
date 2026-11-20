import { BaseEntity } from '@nest-cloud/sdk';
import { Column, Entity, Index } from 'typeorm';

/**
 * Deep Agent 工作区实体。
 * 每个 workspace 对应一个沙箱后端实例及其运行时上下文。
 */
@Entity('deep_agent_workspace')
export class DeepAgentWorkspace extends BaseEntity {
  /** 关联的命名空间 */
  @Index()
  @Column({ name: 'namespace_id', type: 'int' })
  namespaceId!: number;

  /** 工作区唯一标识，用于沙箱后端路由 */
  @Column({ name: 'workspace_id', type: 'varchar', length: 128, unique: true })
  workspaceId!: string;

  /** 工作区显示名称 */
  @Column({ name: 'display_name', type: 'varchar', length: 255, nullable: true })
  displayName!: string | null;

  /** 关联的线程 ID（LangGraph thread_id） */
  @Column({ name: 'thread_id', type: 'varchar', length: 255, nullable: true })
  threadId!: string | null;

  /** 关联的 run ID（LangGraph run_id） */
  @Column({ name: 'run_id', type: 'varchar', length: 255, nullable: true })
  runId!: string | null;

  /** 关联的会话 ID（rag_chat_session.id） */
  @Index()
  @Column({ name: 'session_id', type: 'int', nullable: true })
  sessionId!: number | null;

  /** 关联的账号 ID */
  @Index()
  @Column({ name: 'account_id', type: 'int' })
  accountId!: number;

  /** 工作区状态：running/completed/failed/cancelled */
  @Column({
    name: 'status',
    type: 'varchar',
    length: 32,
    default: 'running',
  })
  status!: string;

  /** 工作区根目录路径（沙箱内虚拟路径） */
  @Column({ name: 'root_path', type: 'varchar', length: 512, nullable: true })
  rootPath!: string | null;

  /** 工作区创建时的磁盘配额（MB） */
  @Column({ name: 'disk_quota_mb', type: 'int', nullable: true })
  diskQuotaMb!: number | null;

  /** 工作区最后一次活跃时间 */
  @Column({ name: 'last_active_at', type: 'timestamp', nullable: true })
  lastActiveAt!: Date | null;
}
