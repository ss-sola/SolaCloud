# Node 内建存储导致前端测试初始化失败

## 现象与触发条件

在 Node 26.13.0、Vitest 4.1.9 和项目的 jsdom 配置下，根目录运行 `pnpm run test` 时，前端 24 个用例均在公共初始化的 `window.localStorage.clear()` 处报错。Node 同时报告未指定 localStorage 文件。使用同一依赖运行未修改的前端源码可以复现全部失败。

## 处理方式

前端的 Vitest 配置在测试子进程中传入 `--no-experimental-webstorage`，由 jsdom 提供浏览器存储。该设置仅在测试进程生效。
