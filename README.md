# SolaCloud

SolaCloud 将网关、系统管理、文件与任务和知识库服务组织在一个 pnpm 工作区中。应用通过 `@nest-cloud/sdk` 接入独立的 NestCloud 控制面。

| 子项目                    | 功能                               | 开发命令                |
| ------------------------- | ---------------------------------- | ----------------------- |
| `apps/gateway-service`    | 浏览器直连的 API 网关与服务发现   | `pnpm start:gateway`    |
| `apps/system-service`     | 登录、权限、账号、菜单、字典和监控 | `pnpm start:system`     |
| `apps/middleware-service` | 文件上传、下载和异步任务           | `pnpm start:middleware` |
| `apps/rag-service`        | 知识库、向量检索和聊天             | `pnpm start:rag`        |
| `apps/call-graph-service` | 项目接口静态分析和运行时方法探针 | `pnpm start:call-graph` |
| `web/NestCloudWeb`        | 业务管理前端                       | `pnpm start:web`        |

接口调用图服务默认使用端口 3500，复用共享登录会话，部署在可信目标项目所在主机。现有系统库需安装接口调用图菜单补丁。[部署与使用](apps/call-graph-service/docs/接口调用图/部署与使用.md)

## 本地开发

将 `NestCloud-Sdk` 与 `SolaCloud` 放在同一父目录。使用 Node.js 24.16 或更高版本以及项目 `packageManager` 指定的 pnpm。在 SolaCloud 根目录执行以下命令。

```sh
pnpm --dir ../NestCloud-Sdk install --frozen-lockfile
pnpm --dir ../NestCloud-Sdk run build
pnpm install --frozen-lockfile
```

SDK 以本地目录包安装。修改 SDK 后先重新构建，再在 SolaCloud 运行 `pnpm install --force` 以更新安装副本。

根工作区、SDK 和前端使用 TypeScript 7。Nest CLI 通过项目内的 TypeScript 6 调用编译器 API。

三个后端均要求通过部署配置提供非空的 `SessionSecret`。同一登录域的各实例使用相同的值。`SessionRedisUrl` 为可选配置，部署需要共享会话时提供 Redis 地址。未配置 Redis 时会话保存在当前进程。其余配置按对应服务的 `src/validate.config.ts` 提供。如使用远程配置或服务发现，先启动独立的 NestCloud。

新建业务库时先执行 `sql/init.sql`，再执行 `sql/init_data.sql`。RAG 的增量补丁位于 `sql/patches/`。首次启用文件描述写重试时，无论是新库还是已有库，都要在 `middleware-service` 使用的 PostgreSQL 数据库执行同级 NestCloud 仓库的 `../NestCloud/sql/sdk/add-rpc-idempotency-record.sql`，再升级所有接收实例，最后开启调用方写重试。[部署与集成测试说明](docs/project/部署与可观测性.md)

首次部署请在执行种子脚本的同一个 PostgreSQL 会话设置 `solacloud.initial_admin_password_hash`，值由 system-service 的 `PasswordUtil.hash` 生成。省略时管理员账号需要先配置密码才可登录。模型 API 密钥按部署环境配置。

在各应用目录复制 `.env.example` 为 `.env`。给三个业务服务填写数据库凭据和共享会话配置。先启动 3001 端口上的 NestCloud，再启动三个业务服务（3200、3300、3400）和网关（3100）。使用 `http://localhost:5173` 访问管理前端，浏览器直接请求 `http://localhost:3100/api/...`。文件预览示例使用 `127.0.0.1:3300`。

部署时通过 `VITE_GATEWAY_ORIGIN` 设置浏览器可访问的网关地址，并在网关的 `GatewayAllowedOrigins` 中配置前端来源。[前端 API 配置](web/NestCloudWeb/docs/api/模块总览.md)

```sh
pnpm build
pnpm lint
pnpm test
pnpm tsgo
```

[项目架构与开发文档](docs/project/index.md)
