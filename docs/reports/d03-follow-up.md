# D03 备份恢复补充验证

2026-09-10。工单：[#37](https://github.com/raime7/PhoskyWiki/issues/37)。既有备份实现与历史真实恢复证据见 [备份手册](../backups.md) 和 [历史证据](d03-backup-evidence.json)。本文仅记录本轮增量，不将历史证据算作本轮重测。

## 改动

`create` 现在在连接数据库、访问 R2 前拒绝缺失、空对象、数组和其他非对象 `runtime`，返回 `RUNTIME_CONFIG_REQUIRED`。这防止完全遗漏恢复配置仍发布成功恢复点；配置具体值是否足以启动对应应用仍须在应用恢复演练中验证。既有恢复点的验证与恢复入口保持兼容。

真实契约补充错误数据库目标、错误桶及源图缺失的非零退出断言；源图缺失后成功清单数不得增加，既有恢复点仍可恢复独立图片副本。

## 本轮结果

- 进程回归：6 项通过；新增输入检查先观察到失败，再实现通过。
- 本轮三个代码文件 ESLint 通过，`pnpm typecheck` 通过。
- 全量 Vitest 执行：279 通过、6 跳过、1 文件加载失败。当时并行工作中的 `write-limits.test.ts` 存在语法错误；该文件修正后单独重测 1 项通过。此记录不宣称全量单次运行全绿。
- 备份 Docker 镜像构建成功：`phoskywiki:d03-backup`，镜像配置 digest `sha256:c5307bab06a658d32ff44d9b0d45d67b0d4cc24dbb34930feb9fc7539debe980`。
- Standards 审查 0 项；Spec 审查 0 项实现缺陷，补充检查失败退出码的建议已落实。

## 真实 R2 重测仍待完成

Cloudflare MCP 已成功连接并列出 `phoskywiki-contract-test`。旧测试令牌此前已撤销，本机秘密目录没有可用的测试桶配置。现有应用/备份凭据无法列桶，应用凭据创建独立测试桶返回 403。MCP 的账户及用户令牌管理接口返回 9109 Unauthorized，不能用该连接签发测试凭据；浏览器工具导航超时。

需要限定到上述测试桶、具有对象读写权限的 S3 凭据。配置只放在维护者受保护秘密目录，不提交仓库。取得配置后执行：

```powershell
$env:BACKUP_CONTRACT_CONFIG = 'C:\Users\raime\.codex\phoskywiki-secrets\d03-contract.json'
$env:BACKUP_CONTRACT_IMAGE = 'phoskywiki:d03-backup'
pnpm test:backups
```

配置字段为 `endpoint`、`bucket`、`accessKeyId`、`secretAccessKey`，桶名必须以 `-test` 结尾。契约只操作本次 UUID 命名空间及临时 PostgreSQL 容器，结束时清理自己的对象。

本輪不关闭 D03，不声称真实契约或新增完整应用恢复演练已通过；未修改线上数据、生产凭据或 DNS。
