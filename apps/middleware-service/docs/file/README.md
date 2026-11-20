# 文件上传

## 文档导航

- [模块总览](模块总览.md)
- [接口清单](接口清单.md)
- [实现逻辑](实现逻辑.md)
- [配置说明](配置说明.md)

当前模块的上传协议已经收敛为唯一一种模式：**分片上传 + 合并**。

- `POST /file/upload/check`：按 `fileId + sourceHash + 分片几何信息` 校验或创建上传状态，返回真实已落盘分片索引。
- `POST /file/upload`：上传单个分片，文件字段名固定为 `file`。
- `POST /file/upload/merge`：在全部分片上传完成后提交 `fileHash` 与最终保存元数据，执行合并并生成正式文件。
- 上传中间态存放在 Redis；正式文件元数据继续落库，正式文件与分片文件继续落本地磁盘。
- 模块同时保留 `GET /file/list`、`GET /file/detail`、`DELETE /file/remove` 用于文件查询与删除。
