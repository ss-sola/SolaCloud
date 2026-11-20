# AGENTS

## 适用范围

- 本文件只维护 `apps/middleware-service` 的专属约束。
- 通用工程约束继续遵守仓库根目录 `AGENTS.md`。

## 文件能力约束

- 文件上传元数据入库时只存相对存储路径，禁止把域名、协议、网关前缀等部署相关完整 URL 固化到数据库。
- 返回给前端的文件访问字段必须统一组装完整路径，下载使用 `url`，预览统一使用 `previewUrl`。

## BullMQ 上下文传递约束

- `TaskQueueService.addJob` 和 `addRepeatableJob` 会自动从 `ContextService.getReq()` 捕获当前请求 header，存入 job data 的 `_headers` 字段，无需业务代码手动捕获。
- Worker 处理函数必须通过 `createWorkerHandler` 包装，该方法从 `job.data._headers` 提取 header 并通过 `ContextService.setStore` 恢复异步上下文，使 `RemoteClientBase` 能正常获取 header 透传给下游服务。
- 业务代码禁止手动调用 `ContextService.getReq()` 捕获 header 或直接在 worker 中使用裸 `fetch` 调用其他服务，统一通过 `TaskQueueService.addJob` + `RagServiceClient` 模式。
