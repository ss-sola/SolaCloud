# SolaCloud

SolaCloud 将系统管理、文件与任务和知识库服务组织在一个 pnpm 工作区中。三个后端通过 `@nest-cloud/sdk` 接入独立的 NestCloud 注册中心和配置中心。

| 子项目                    | 功能                               | 开发命令                |
| ------------------------- | ---------------------------------- | ----------------------- |
| `apps/system-service`     | 登录、权限、账号、菜单、字典和监控 | `pnpm start:system`     |
| `apps/middleware-service` | 文件上传、下载和异步任务           | `pnpm start:middleware` |
| `apps/rag-service`        | 知识库、向量检索和聊天             | `pnpm start:rag`        |
| `web/NestCloudWeb`        | 业务管理前端                       | `pnpm start:web`        |

## 本地开发

将 `NestCloud-Sdk` 与 `SolaCloud` 放在同一父目录。使用 Node.js 24.16 或更高版本以及项目 `packageManager` 指定的 pnpm。在 SolaCloud 根目录执行以下命令。

```sh
pnpm --dir ../NestCloud-Sdk install --frozen-lockfile
pnpm --dir ../NestCloud-Sdk run build
pnpm install --frozen-lockfile
```

SDK 以本地目录包安装。修改 SDK 后先重新构建，再在 SolaCloud 运行 `pnpm install --force` 以更新安装副本。

三个后端均要求通过部署配置提供非空的 `SessionSecret`。同一登录域的各实例使用相同的值。`SessionRedisUrl` 为可选配置，部署需要共享会话时提供 Redis 地址。未配置 Redis 时会话保存在当前进程。其余配置按对应服务的 `src/validate.config.ts` 提供。如使用远程配置或服务发现，先启动独立的 NestCloud。

新建业务库时先执行 `sql/init.sql`，再执行 `sql/init_data.sql`。RAG 的增量补丁位于 `sql/patches/`。首次启用文件描述写重试时，无论是新库还是已有库，都要在 `middleware-service` 使用的 PostgreSQL 数据库执行同级 NestCloud 仓库的 `../NestCloud/sql/sdk/add-rpc-idempotency-record.sql`，再升级所有接收实例，最后开启调用方写重试。[部署与集成测试说明](docs/project/部署与可观测性.md)

首次部署请在执行种子脚本的同一个 PostgreSQL 会话设置 `solacloud.initial_admin_password_hash`，值由 system-service 的 `PasswordUtil.hash` 生成。省略时管理员账号需要先配置密码才可登录。模型 API 密钥按部署环境配置。

在各后端目录复制 `.env.example` 为 `.env`，填写数据库凭据和共用的 `SessionSecret`。示例使用本机 PostgreSQL 和 Redis，三个后端分别监听 3200、3300、3400。先启动 3001 端口上的 NestCloud，再运行上表的各项开发命令。管理前端默认使用 5173。

```sh
pnpm build
pnpm lint
pnpm test
pnpm tsgo
```

[项目架构与开发文档](docs/project/index.md)
