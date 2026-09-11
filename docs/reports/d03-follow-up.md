# D03 备份恢复补充验证

2026-09-10。工单：[#37](https://github.com/raime7/PhoskyWiki/issues/37)。既有备份实现与历史真实恢复证据见 [备份手册](../backups.md) 和 历史证据（本机原始证据，不随仓库分发：`d03-backup-evidence.json`）。本文仅记录本轮增量，不将历史证据算作本轮重测。

## 改动

`create` 现在在连接数据库、访问 R2 前拒绝缺失、空对象、数组和其他非对象 `runtime`，返回 `RUNTIME_CONFIG_REQUIRED`。这防止完全遗漏恢复配置仍发布成功恢复点；配置具体值是否足以启动对应应用仍须在应用恢复演练中验证。既有恢复点的验证与恢复入口保持兼容。

真实契约补充错误数据库目标、错误桶及源图缺失的非零退出断言；源图缺失后成功清单数不得增加，既有恢复点仍可恢复独立图片副本。

Windows 上的契约将秘密配置通过 `docker cp` 放入本次 UUID 的 Linux 卷，并设置 POSIX 权限，避免 Windows bind mount 权限映射导致 `CONFIG_PERMISSIONS`。CLI 容器显式命名，超时也在 `finally` 中强制删除；正常结束清理临时数据库、网络、配置卷及本次 R2 对象。

## 本轮结果

- 进程回归：6 项通过；新增输入检查先观察到失败，再实现通过。
- 本轮三个代码文件 ESLint 通过，`pnpm typecheck` 通过。
- 最终全量 Vitest：41 文件通过、2 文件跳过；285 项通过、6 项跳过，退出码 0。真实备份契约另外单独运行，不以跳过项替代真实服务验收。
- 备份 Docker 镜像构建成功：`phoskywiki:d03-backup`，镜像配置 digest `sha256:c5307bab06a658d32ff44d9b0d45d67b0d4cc24dbb34930feb9fc7539debe980`。
- Standards 与 Spec 审查最终均无遗留发现；失败退出码建议及超时残留容器问题均已修复并复核。

## 真实 R2 重测通过

维护者提供独立令牌管理凭据后，通过账户令牌 API 创建仅限 `phoskywiki-contract-test` 的对象读写凭据，有效期一天。MCP OAuth 的全部可选权限不包含 API Token 管理权限；之前 9109 并非维护者漏选授权项。秘密仅保存在本机受保护目录。

最终测试镜像与真实 PostgreSQL 18、R2 契约退出码为 0。覆盖一致性数据库及图片恢复、已有数据库覆盖拒绝、错误目标/桶/密钥、文件损坏、备份缺图、源图缺失不得发布成功清单、版本不兼容、上传失败、源删除后独立副本恢复、图片增量复用、清单大小边界、恢复运行配置及离线导出校验。执行入口：

```powershell
$env:BACKUP_CONTRACT_CONFIG = 'C:\Users\raime\.codex\phoskywiki-secrets\d03-contract.json'
$env:BACKUP_CONTRACT_IMAGE = 'phoskywiki:d03-backup'
pnpm test:backups
```

配置字段为 `endpoint`、`bucket`、`accessKeyId`、`secretAccessKey`，桶名必须以 `-test` 结尾。契约只操作本次 UUID 命名空间及临时 PostgreSQL 容器，结束时清理自己的对象。

另用实际凭据验证：应用凭据对备份桶的 ListObjectsV2 返回 403；本次测试凭据对生产图片桶的同一请求返回 403。

本轮增量实现及真实命令契约完成。账号登录、公开/私有内容、历史修订、真实图片权限与搜索的应用恢复验收沿用上方链接的既有历史证据，本轮没有新增完整网站恢复演练。未修改线上数据、生产凭据或 DNS；GitHub 工单状态未修改。
