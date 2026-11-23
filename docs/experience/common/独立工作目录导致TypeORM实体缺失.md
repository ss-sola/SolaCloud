# 独立工作目录导致 TypeORM 实体缺失

本地以独立工作目录启动第二个 `system-service` 实例时，`Pattern` 指向了原构建目录，SDK 因而成功加载控制器。TypeORM 通过 `${process.cwd()}/dist/**/*.entity.js` 查找实体，实例工作目录中没有 `dist`，导致登录查询报出 `No metadata for "AccountItem" was found.`。未登录的 `/api/system/auth/current` 提前返回 `401`，无法发现缺失的实体。

启动副本时，让每个实例的工作目录中 `dist` 指向同一套构建产物。本机通过 Windows 目录联接补齐 `3201` 的 `dist`，确认 Node 从两个路径解析到相同实体模块后重启实例。

通过网关用一次性账号进行回归。根据请求 trace 核对两个实例分别处理 `POST /api/system/auth/login` 并返回 `200`，再让同一个会话 Cookie 请求两个实例的 `GET /api/system/auth/current`，确认均返回原账号。
