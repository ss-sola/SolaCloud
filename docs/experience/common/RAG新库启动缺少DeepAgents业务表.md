# RAG 新库启动缺少 DeepAgents 业务表

## 复现条件

在启用了 pgvector 的全新 PostgreSQL 16 业务库执行 `sql/init.sql` 和 `sql/init_data.sql`，关闭 TypeORM 自动同步，启动 `rag-service`。进程会先监听 HTTP 端口，然后在启动钩子访问默认命名空间时退出，数据库返回 `relation "deep_agent_namespace" does not exist`。

## 原因与验证

旧版初始化脚本缺少 RAG 实体 `deep_agent_namespace` 和 `deep_agent_workspace` 的表定义。两张表由 RAG 业务维护。SDK 的幂等建表脚本只负责 `rpc_idempotency_record`。

初始化脚本末尾已补齐这两张表及工作区索引。新业务库直接执行初始化脚本，已有业务库可单独执行末尾的 DeepAgents 段落。验收启动时应等待启动钩子完成，再验证业务接口与进程状态。
