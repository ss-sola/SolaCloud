/**
 * rag-service 专用配置键常量。
 */
export const RagConfigKeys = {
  /** 共享上传文件根目录，用于根据 fileId 定位真实文件。 */
  UploadRootDir: 'UploadRootDir',
  /** 共享上传文件公开访问前缀，用于回填 fileUrl 引用。 */
  UploadPublicBaseUrl: 'UploadPublicBaseUrl',
  /** OpenAI 兼容 API 的密钥，用于 LLM/Embedding 调用。 */
  OpenAIApiKey: 'OpenAIApiKey',
  /** Deep Agents 工作区根目录，用于沙箱内文件读写。 */
  DeepAgentsWorkspaceRoot: 'DeepAgentsWorkspaceRoot',
  /** Deep Agents 沙箱超时时间（毫秒），超时后终止运行。 */
  DeepAgentsSandboxTimeoutMs: 'DeepAgentsSandboxTimeoutMs',
  /** Deep Agents 单个工作区磁盘上限（MB）。 */
  DeepAgentsDiskQuotaMb: 'DeepAgentsDiskQuotaMb',
  /** Deep Agents 工作区清理周期（秒），超过此时间的空闲工作区将被清理。 */
  DeepAgentsCleanupIntervalSec: 'DeepAgentsCleanupIntervalSec',
} as const;
