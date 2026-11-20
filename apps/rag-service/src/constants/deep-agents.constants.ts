/** Deep Agents 运行时常量 */

/** Deep Agents 默认工作区根目录，用于沙箱内文件读写。 */
export const DEFAULT_DEEP_AGENTS_WORKSPACE_ROOT = 'public/deep-agents';

/** Deep Agents 默认工作区磁盘上限（MB） */
export const DEFAULT_DEEP_AGENTS_DISK_QUOTA_MB = 512;

/** Deep Agents 默认沙箱后端类型：sandbox（官方兼容沙箱），不使用宿主机文件系统 */
export const DEEP_AGENTS_DEFAULT_BACKEND = 'sandbox' as const;

/** Deep Agents 默认沙箱超时（毫秒） */
export const DEFAULT_DEEP_AGENTS_SANDBOX_TIMEOUT_MS = 300_000;

/** Deep Agents 默认清理周期（秒） */
export const DEFAULT_DEEP_AGENTS_CLEANUP_INTERVAL_SEC = 3600;

/** Deep Agents 后端类型枚举 */
export const DEEP_AGENTS_BACKEND_TYPE = {
  /** 官方兼容沙箱后端（推荐） */
  Sandbox: 'sandbox',
  /** 基于 PostgreSQL 的持久化存储后端 */
  Store: 'store',
} as const;

export type DeepAgentsBackendType =
  (typeof DEEP_AGENTS_BACKEND_TYPE)[keyof typeof DEEP_AGENTS_BACKEND_TYPE];

/** Deep Agent 生命周期状态 */
export const DEEP_AGENT_LIFECYCLE_STATUS = {
  /** 运行中 */
  Running: 'running',
  /** 已完成 */
  Completed: 'completed',
  /** 已失败 */
  Failed: 'failed',
  /** 已取消 */
  Cancelled: 'cancelled',
} as const;

export type DeepAgentLifecycleStatus =
  (typeof DEEP_AGENT_LIFECYCLE_STATUS)[keyof typeof DEEP_AGENT_LIFECYCLE_STATUS];
