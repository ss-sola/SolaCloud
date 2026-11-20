/** middleware-service specific config keys. */
export const MiddlewareConfigKeys = {
  /** Redis URL for shared session storage; absent means in-memory fallback. */
  SessionRedisUrl: 'SessionRedisUrl',
  /** Cookie signing secret for shared session (required to enable session). */
  SessionSecret: 'SessionSecret',
  /** Browser cookie name for shared session, default 'system.sid'. */
  SessionCookieName: 'SessionCookieName',
  /** Session TTL in milliseconds, default 8h. */
  SessionTtlMs: 'SessionTtlMs',
  /** Redis key prefix for shared session records, default 'system-session'. */
  SessionKeyPrefix: 'SessionKeyPrefix',
  /** SameSite policy for shared session cookie, default 'lax'. */
  SessionSameSite: 'SessionSameSite',
  /** Whether to mark shared session cookie as secure. */
  SessionSecure: 'SessionSecure',
  /** 上传文件根目录，默认 public/uploads。 */
  UploadRootDir: 'UploadRootDir',
  /** 单文件最大字节数。 */
  UploadMaxSizeBytes: 'UploadMaxSizeBytes',
  /** 分片临时目录根路径。 */
  UploadChunkTempRootDir: 'UploadChunkTempRootDir',
  /** 上传文件公开访问前缀。 */
  UploadPublicBaseUrl: 'UploadPublicBaseUrl',
  /** 服务对外公开访问地址（如 https://api.example.com），用于组装完整文件访问 URL。 */
  ServicePublicBaseUrl: 'ServicePublicBaseUrl',
  /** 临时上传文件保留时长（毫秒）。 */
  UploadTempTtlMs: 'UploadTempTtlMs',
  /** 文件上传 Redis key 前缀。 */
  FileUploadRedisPrefix: 'FileUploadRedisPrefix',
  /** BullMQ Redis 连接 URL。 */
  QueueRedisUrl: 'QueueRedisUrl',
  /** BullMQ Redis key 前缀。 */
  QueuePrefix: 'QueuePrefix',
  /** BullMQ worker 默认并发数。 */
  QueueDefaultConcurrency: 'QueueDefaultConcurrency',
  /** BullMQ job 默认重试次数。 */
  QueueDefaultAttempts: 'QueueDefaultAttempts',
  /** BullMQ job 默认退避毫秒数。 */
  QueueDefaultBackoffMs: 'QueueDefaultBackoffMs',
  /** 上传临时文件清理 cron 表达式。 */
  QueueCleanupCron: 'QueueCleanupCron',
  /** 是否启用 bull-board 面板。 */
  BullBoardEnabled: 'BullBoardEnabled',
  /** bull-board 面板挂载路径。 */
  BullBoardRoute: 'BullBoardRoute',
  /** 附件向量化队列并发数。 */
  AttachmentVectorizeConcurrency: 'AttachmentVectorizeConcurrency',
} as const;
