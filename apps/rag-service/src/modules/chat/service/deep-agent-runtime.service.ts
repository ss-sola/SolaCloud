import {
  AfterApplicationBootstrap,
  BaseService,
  getConfig,
  ProjectException,
} from '@nest-cloud/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { DeepAgentNamespace } from '../entity/deep-agent-namespace.entity';
import { DeepAgentWorkspace } from '../entity/deep-agent-workspace.entity';
import {
  DEFAULT_DEEP_AGENTS_CLEANUP_INTERVAL_SEC,
  DEFAULT_DEEP_AGENTS_DISK_QUOTA_MB,
  DEFAULT_DEEP_AGENTS_SANDBOX_TIMEOUT_MS,
  DEFAULT_DEEP_AGENTS_WORKSPACE_ROOT,
  DEEP_AGENTS_BACKEND_TYPE,
} from '../../../constants/deep-agents.constants';
import { RagConfigKeys } from '../../../config-keys';

/**
 * Deep Agent 运行时初始化状态。
 */
export interface RuntimeInitResult {
  /** 是否成功初始化 */
  success: boolean;
  /** 使用的后端类型 */
  backendType: string;
  /** 工作区根目录 */
  workspaceRoot: string;
  /** 初始化详情 */
  details: string;
}

/**
 * Deep Agent 运行时配置。
 */
export interface DeepAgentRuntimeConfig {
  /** 工作区根目录 */
  workspaceRoot: string;
  /** 沙箱超时时间（毫秒） */
  sandboxTimeoutMs: number;
  /** 磁盘上限（MB） */
  diskQuotaMb: number;
  /** 清理周期（秒） */
  cleanupIntervalSec: number;
  /** 后端类型 */
  backendType: string;
}

/**
 * Deep Agent 运行时配置服务。
 *
 * 职责：
 * - 管理 Deep Agents 的运行时配置（工作区、沙箱、checkpointer、store）
 * - 提供账号/会话/线程到 workspace 的映射关系
 * - 初始化时执行 fail-closed 检查，确保功能完整
 * - 选择当前版本支持的沙箱 backend，不使用宿主机仓库目录作为工作区
 * - 接入官方兼容的 PostgreSQL checkpointer/store
 */
@Injectable()
export class DeepAgentRuntimeService
  extends BaseService<DeepAgentWorkspace>
  implements AfterApplicationBootstrap
{
  private readonly logger = new Logger(DeepAgentRuntimeService.name);
  private readonly namespaceRepo: Repository<DeepAgentNamespace>;
  private readonly workspaceRepo: Repository<DeepAgentWorkspace>;
  private readonly runtimeConfig: DeepAgentRuntimeConfig;
  private initialized = false;

  /** PostgreSQL 持久化 checkpointer（延迟创建，在 initialize 中 setup） */
  private postgresCheckpointer: unknown = null;
  /** PostgreSQL 持久化 store（延迟创建，在 initialize 中 start） */
  private postgresStore: unknown = null;

  constructor(
    @InjectRepository(DeepAgentWorkspace)
    protected readonly repository: Repository<DeepAgentWorkspace>,
    private readonly dataSource: DataSource,
  ) {
    super(repository);
    this.namespaceRepo = this.dataSource.getRepository(DeepAgentNamespace);
    this.workspaceRepo = this.dataSource.getRepository(DeepAgentWorkspace);
    this.runtimeConfig = this.buildRuntimeConfig();
  }

  /**
   * 构建运行时配置。
   * 所有运行时参数通过 getConfig 读取，不从硬编码获取。
   */
  private buildRuntimeConfig(): DeepAgentRuntimeConfig {
    const workspaceRoot = getConfig<string>(
      RagConfigKeys.DeepAgentsWorkspaceRoot,
      DEFAULT_DEEP_AGENTS_WORKSPACE_ROOT,
      false,
    );
    const sandboxTimeoutMs = getConfig<number>(
      RagConfigKeys.DeepAgentsSandboxTimeoutMs,
      DEFAULT_DEEP_AGENTS_SANDBOX_TIMEOUT_MS,
    );
    const diskQuotaMb = getConfig<number>(
      RagConfigKeys.DeepAgentsDiskQuotaMb,
      DEFAULT_DEEP_AGENTS_DISK_QUOTA_MB,
    );
    const cleanupIntervalSec = getConfig<number>(
      RagConfigKeys.DeepAgentsCleanupIntervalSec,
      DEFAULT_DEEP_AGENTS_CLEANUP_INTERVAL_SEC,
    );

    return {
      workspaceRoot,
      sandboxTimeoutMs,
      diskQuotaMb,
      cleanupIntervalSec,
      backendType: DEEP_AGENTS_BACKEND_TYPE.Sandbox,
    };
  }

  /**
   * 获取当前运行时配置（不可变副本）。
   */
  getConfig(): DeepAgentRuntimeConfig {
    return { ...this.runtimeConfig };
  }

  /**
   * 检查运行时是否已初始化成功。
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 初始化 Deep Agents 运行时。
   *
   * Fail-closed 策略：如果关键配置缺失或无效，抛出异常阻止启动，
   * 不创建功能残缺的 Agent。
   *
   * 检查项：
   * 1. 工作区根目录配置必须存在
   * 2. 后端类型必须是受支持的沙箱后端
   */
  async initialize(): Promise<RuntimeInitResult> {
    try {
      const config = this.getConfig();

      // 1. 检查工作区根目录配置
      if (!config.workspaceRoot || config.workspaceRoot.trim().length === 0) {
        throw new ProjectException('Deep Agents 工作区根目录未配置，无法初始化运行时');
      }

      // 2. 检查后端类型
      if (config.backendType !== DEEP_AGENTS_BACKEND_TYPE.Sandbox) {
        throw new ProjectException(`Deep Agents 不支持的后端类型: ${config.backendType}`);
      }

      // 3. 初始化 PostgreSQL checkpointer（复用 TypeORM DataSource）
      await this.initializePostgresCheckpointer();

      // 4. 初始化 PostgreSQL store（复用 TypeORM DataSource）
      await this.initializePostgresStore();

      // 5. 确保默认命名空间存在
      await this.ensureDefaultNamespace();

      this.initialized = true;

      this.logger.log(
        `Deep Agents 运行时初始化成功: workspaceRoot=${config.workspaceRoot}, ` +
          `sandboxTimeout=${config.sandboxTimeoutMs}ms, ` +
          `diskQuota=${config.diskQuotaMb}MB, ` +
          `cleanupInterval=${config.cleanupIntervalSec}s, ` +
          `checkpointBackend=PostgreSQL, storeBackend=PostgreSQL`,
      );

      return {
        success: true,
        backendType: config.backendType,
        workspaceRoot: config.workspaceRoot,
        details: '运行时初始化成功，所有检查项通过',
      };
    } catch (error) {
      this.initialized = false;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Deep Agents 运行时初始化失败: ${message}`);
      throw error;
    }
  }

  /**
   * 应用启动后钩子：初始化 Deep Agents 运行时。
   */
  async afterApplicationBootstrap(): Promise<void> {
    await this.initialize();
  }

  /**
   * 获取或创建默认命名空间。
   */
  private async ensureDefaultNamespace(): Promise<DeepAgentNamespace> {
    const defaultCode = 'default';
    let namespace = await this.namespaceRepo.findOneBy({ namespaceCode: defaultCode });

    if (!namespace) {
      namespace = this.namespaceRepo.create({
        namespaceCode: defaultCode,
        displayName: '默认命名空间',
        description: '系统默认 Deep Agent 命名空间',
      });
      namespace = await this.namespaceRepo.save(namespace);
      this.logger.log(`创建默认命名空间: ${namespace.id}`);
    }

    return namespace;
  }

  /**
   * 根据账号 ID 和会话 ID 获取或创建工作区。
   *
   * 映射关系：account -> namespace -> session -> workspace
   *
   * @param accountId - 账号 ID
   * @param sessionId - 会话 ID（可选，不提供时创建独立工作区）
   * @param threadId - LangGraph 线程 ID（可选）
   * @returns 工作区实体
   */
  async getOrCreateWorkspace(options: {
    accountId: number;
    sessionId?: number;
    threadId?: string;
  }): Promise<DeepAgentWorkspace> {
    if (!this.initialized) {
      throw new ProjectException('Deep Agents 运行时未初始化，无法创建工作区');
    }

    // 优先使用 sessionId 查找已有工作区
    if (options.sessionId) {
      const existing = await this.workspaceRepo.findOne({
        where: {
          sessionId: options.sessionId,
          accountId: options.accountId,
          deletedAt: IsNull(),
        },
      });

      if (existing) {
        // 更新最后活跃时间
        existing.lastActiveAt = new Date();
        await this.workspaceRepo.save(existing);
        return existing;
      }
    }

    // 创建新工作区
    const config = this.getConfig();
    const namespace = await this.getDefaultNamespace();
    const workspaceId = this.generateWorkspaceId(options.accountId, options.sessionId);

    const workspace = this.repository.create({
      namespaceId: namespace.id,
      workspaceId,
      displayName: `workspace-${workspaceId}`,
      threadId: options.threadId || null,
      runId: null,
      sessionId: options.sessionId || null,
      accountId: options.accountId,
      status: 'running',
      rootPath: `${config.workspaceRoot}/${workspaceId}`,
      diskQuotaMb: config.diskQuotaMb,
      lastActiveAt: new Date(),
    });

    return this.repository.save(workspace);
  }

  /**
   * 根据账号 ID 和会话 ID 获取已有工作区（不创建）。
   *
   * @param accountId - 账号 ID
   * @param sessionId - 会话 ID
   * @returns 工作区实体，不存在返回 null
   */
  async findWorkspaceBySession(
    accountId: number,
    sessionId: number,
  ): Promise<DeepAgentWorkspace | null> {
    return this.workspaceRepo.findOne({
      where: {
        sessionId,
        accountId,
        deletedAt: IsNull(),
      },
    });
  }

  /**
   * 根据工作区 ID 获取工作区。
   *
   * @param workspaceId - 工作区唯一标识
   * @returns 工作区实体，不存在返回 null
   */
  async findWorkspaceById(workspaceId: string): Promise<DeepAgentWorkspace | null> {
    return this.workspaceRepo.findOne({
      where: { workspaceId, deletedAt: IsNull() },
    });
  }

  /**
   * 更新工作区的 threadId。
   *
   * @param workspaceId - 工作区唯一标识
   * @param threadId - LangGraph 线程 ID
   */
  async updateWorkspaceThreadId(workspaceId: string, threadId: string): Promise<void> {
    await this.workspaceRepo.update({ workspaceId, deletedAt: IsNull() }, { threadId });
  }

  /**
   * 取消工作区。
   *
   * @param workspaceId - 工作区唯一标识
   */
  async cancelWorkspace(workspaceId: string): Promise<void> {
    await this.workspaceRepo.update({ workspaceId, deletedAt: IsNull() }, { status: 'cancelled' });
  }

  /**
   * 更新工作区的 runId 用于追踪。
   *
   * @param workspaceId - 工作区唯一标识
   * @param runId - Deep Agent run ID
   */
  async updateWorkspaceRunId(workspaceId: string, runId: string): Promise<void> {
    await this.workspaceRepo.update({ workspaceId, deletedAt: IsNull() }, { runId });
  }

  /**
   * 标记工作区为完成状态。
   *
   * @param workspaceId - 工作区唯一标识
   */
  async markWorkspaceCompleted(workspaceId: string): Promise<void> {
    await this.workspaceRepo.update({ workspaceId, deletedAt: IsNull() }, { status: 'completed' });
  }

  /**
   * 标记工作区为失败状态。
   *
   * @param workspaceId - 工作区唯一标识
   * @param errorMessage - 错误信息
   */
  async markWorkspaceFailed(workspaceId: string, errorMessage: string): Promise<void> {
    await this.workspaceRepo.update({ workspaceId, deletedAt: IsNull() }, { status: 'failed' });
    this.logger.warn(`工作区标记为失败: ${workspaceId}, 原因: ${errorMessage}`);
  }

  /**
   * 清理过期的空闲工作区。
   *
   * 清理条件：
   * - 状态为 completed 或 cancelled
   * - 最后活跃时间早于清理周期阈值
   *
   * @param now - 当前时间，用于测试注入
   * @returns 清理的工作区数量
   */
  async cleanupExpiredWorkspaces(now?: Date): Promise<number> {
    if (!this.initialized) {
      return 0;
    }

    const config = this.getConfig();
    const cutoffTime = new Date((now ?? new Date()).getTime() - config.cleanupIntervalSec * 1000);

    const result = await this.workspaceRepo
      .createQueryBuilder()
      .delete()
      .where('deleted_at IS NULL')
      .andWhere('status IN (:...statuses)', {
        statuses: ['completed', 'cancelled'],
      })
      .andWhere('last_active_at < :cutoff', { cutoffTime })
      .execute();

    if (result.affected && result.affected > 0) {
      this.logger.log(`清理过期工作区: ${result.affected} 个`);
    }

    return result.affected ?? 0;
  }

  /**
   * 获取指定账号的所有活跃工作区。
   *
   * @param accountId - 账号 ID
   * @returns 活跃工作区列表
   */
  async findActiveWorkspacesByAccount(accountId: number): Promise<DeepAgentWorkspace[]> {
    return this.workspaceRepo.find({
      where: {
        accountId,
        status: 'running',
        deletedAt: IsNull(),
      },
      order: { lastActiveAt: 'DESC' },
    });
  }

  /**
   * 初始化 PostgreSQL checkpointer。
   * 复用 TypeORM 的 DataSource 连接池，首次调用 setup() 自动创建表。
   */
  private async initializePostgresCheckpointer(): Promise<void> {
    try {
      const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
      // 复用 TypeORM DataSource 的连接配置
      const pgConfig = this.dataSource.options as {
        host: string;
        port: number;
        username: string;
        password: string;
        database: string;
      };
      const connString = `postgresql://${pgConfig.username}:${pgConfig.password}@${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`;
      this.postgresCheckpointer = PostgresSaver.fromConnString(connString, {
        schema: 'langgraph',
      });
      await (this.postgresCheckpointer as { setup(): Promise<void> }).setup();
      this.logger.log('PostgreSQL checkpointer 初始化成功');
    } catch (error) {
      this.logger.error(
        `PostgreSQL checkpointer 初始化失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ProjectException(
        `Deep Agents PostgreSQL checkpointer 初始化失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 初始化 PostgreSQL store。
   * 复用 TypeORM 的 DataSource 连接池，首次调用 start() 自动创建表。
   */
  private async initializePostgresStore(): Promise<void> {
    try {
      const { PostgresStore } = await import('@langchain/langgraph-checkpoint-postgres/store');
      // 复用 TypeORM DataSource 的连接配置
      const pgConfig = this.dataSource.options as {
        host: string;
        port: number;
        username: string;
        password: string;
        database: string;
      };
      const connString = `postgresql://${pgConfig.username}:${pgConfig.password}@${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`;
      this.postgresStore = PostgresStore.fromConnString(connString);
      await (this.postgresStore as { start(): Promise<void> }).start();
      this.logger.log('PostgreSQL store 初始化成功');
    } catch (error) {
      this.logger.error(
        `PostgreSQL store 初始化失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ProjectException(
        `Deep Agents PostgreSQL store 初始化失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 获取已初始化的 checkpointer。
   * 如果未配置 PostgreSQL 连接字符串，返回 null（调用方 fallback 到 MemorySaver）。
   */
  getCheckpointer(): unknown {
    return this.postgresCheckpointer;
  }

  /**
   * 获取已初始化的 store。
   * 如果未配置 PostgreSQL 连接字符串，返回 null（调用方 fallback 到 InMemoryStore）。
   */
  getStore(): unknown {
    return this.postgresStore;
  }
  /**
   * 获取默认命名空间。
   */
  private async getDefaultNamespace(): Promise<DeepAgentNamespace> {
    const namespace = await this.namespaceRepo.findOneBy({ namespaceCode: 'default' });
    if (!namespace) {
      throw new ProjectException('默认命名空间不存在，请重新初始化运行时');
    }
    return namespace;
  }

  /**
   * 生成工作区唯一标识。
   * 格式：ws-{accountId}-{sessionId}-{timestamp}
   */
  private generateWorkspaceId(accountId: number, sessionId?: number): string {
    const timestamp = Date.now().toString(36);
    const base = sessionId
      ? `ws-${accountId}-${sessionId}-${timestamp}`
      : `ws-${accountId}-${timestamp}`;
    return base.slice(0, 128);
  }
}
