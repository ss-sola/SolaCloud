# RAG Service 启动说明

## pgvector 扩展依赖

当前 `.env` 中 `DbSynchronize=false`，因为 PostgreSQL 未安装 pgvector 扩展。

### 安装 pgvector（Windows）

1. 下载预编译 DLL：https://github.com/pgvector/pgvector/releases
2. 解压后将 `vector.dll` 和 `vector--0.8.0.sql` 复制到 PostgreSQL 安装目录：
   - `vector.dll` → `lib/`
   - `vector.control` 和 `.sql` → `share/extension/`
3. 重启 PostgreSQL 服务
4. 执行 `sql/rag-service.sql` 创建表
5. 修改 `.env` 中 `DbSynchronize=true`

### 或使用 Docker（推荐）

```bash
docker run -d --name pgvector -p 5433:5432 \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}" pgvector/pgvector:pg16
```

更新 `.env` 中 `DbPort=5433`，然后执行 `sql/rag-service.sql`。

## 当前可用功能

- 知识库 CRUD（不含向量化）
- 聊天会话管理
- LLM 对话（不含检索）

安装 pgvector 后完整功能可用。
