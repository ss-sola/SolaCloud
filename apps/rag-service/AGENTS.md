# AGENTS

## 适用范围

- 本文件只维护 `apps/rag-service` 的专属约束。
- 通用工程约束继续遵守仓库根目录 `AGENTS.md`。

## RAG 服务约束

- 所有 LLM / Embedding 模型调用必须通过 LangChain 抽象层，禁止直接使用裸 SDK 调用；模型切换只需修改配置，不改业务代码。
- 向量存储使用 pgvector，向量维度由配置 `EmbeddingDimension` 决定；新增模型时需确认维度一致性。
- 文档处理（解析、分片、向量化）为异步流程，不在 HTTP 请求内同步完成；使用处理状态跟踪进度。
- SSE 流式响应使用 NestJS `@Sse()` + `Observable<MessageEvent>`，不自建 WebSocket。
- 文件访问依赖 middleware-service 的 `FileItem`，rag-service 仅存储 `file_id` 引用，文件基本信息通过 `FileServiceClient` HTTP 获取，不重复存储文件内容。
- 聊天来源引用必须包含 `chunkId`、`documentId`、`fileId`、`score`，前端据此渲染 FilePreview。
