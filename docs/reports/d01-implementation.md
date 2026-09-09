# D01 实施与验收记录

日期：2026-09-09。工单：[D01 / #35](https://github.com/raime7/PhoskyWiki/issues/35)。操作手册：[production.md](../production.md)。实现提交：`ebd41307ce7f595ddbd4227477d45317c60d67ee`。

## 已交付

- 独立生产 Dockerfile/Compose/Caddy；Node、pnpm、锁文件及基础镜像 digest 固定，应用生产构建，运行时从受保护文件读秘密。
- `ops:production verify|migrate|bootstrap|reindex`：确认数据库/搜索目标；事务与并发锁保护只创建缺失的两位管理员及真实编委会；角色/凭据/编委会冲突明确失败，不覆盖原密码或正文。
- 演示 seed 的生产保护；隔离测试库、索引和对象存储环境；浏览器测试不复用已有网站。
- 生产容器 CI 验收入口及首次运行、重试、失败处理、数据卷、停止/替换、版本查看和资源预算说明。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck`、`pnpm lint`、diff 空白检查 | 通过 |
| `pnpm test` | 265 通过，1 跳过；唯一跳过为未配置专用桶的真实 R2 契约 |
| 初始化真实子进程 + 隔离 PostgreSQL | 6 项通过：并发/重复、错误目标/缺配置、普通编者冲突、事务回滚、半成账号/未标记编委会冲突、生产 seed 保护 |
| 生产模式 Playwright 认证/内容生产回归 | 5 项通过，包括注册/登录/会话、编者提交和管理员发布 |
| 固定提交的真实容器验收 | 通过；临时干净检出 `ebd4130`，报告 `dirty=false` |

最终容器测试于北京时间 10:45:35–10:48:23 执行。镜像为 `sha256:076515879e949126d35e53d72f38062700da68fef5c77d1e243b46d406b5ca42`；原始脱敏证据见 [d01-container-evidence.json](d01-container-evidence.json)。

真实 Docker Desktop / WSL2 容器完成了：从无生产配置的构建环境生成镜像；四服务健康检查；不发布应用/PG/搜索宿主端口；错误迁移目标拒绝；迁移与初始化；并发重试；两位管理员浏览器登录；网站 HTTP 创建首条正文词条；新建及管理员直编修订；真实 Meilisearch 重建和检索；应用重启及强制替换后原密码登录、正文、修订和图片元数据保留。

图片元数据由真实网站上传 API 创建并在数据库中核对持久性；没有上传图片字节，也没有以该项替代真实 R2 验收。临时容器项目、数据卷和秘密卷在测试结束后清理。

## 资源观测与未完成项

| 进程/容器 | 本次峰值 |
| --- | --- |
| 应用 cgroup | 164.6 MiB |
| PostgreSQL cgroup | 105.2 MiB |
| Meilisearch cgroup | 147.5 MiB |
| Caddy cgroup | 22.6 MiB |
| 运维 Node 进程最大 RSS | 122.8 MiB |

四个常驻容器均未 OOM。各 cgroup 峰值取自进程生命周期（包括替换前采集）；这些峰值并非同一时刻，不能当作整机并发峰值。测试按照手册的容器预算限制运行，但宿主是本地 Docker Desktop，不是 1 vCPU / 2 GB Vultr 实例。测试数据只有首条词条与少量修订，不能推出真实容量已验收。

**尚未完成：**真实 Vultr 2 GB 机器的组合负载/宿主峰值、真实 R2 图片字节/CORS、phoskywiki.org/Cloudflare/TLS 与大陆网络验收。D03 的备份完成后还需组合备份负载。这些需要真实资源及后续任务；D01 的仓库实现和本地验收通过，不代表整个部署规格或真实站点交付完成。

## Standards

并行规范审查未发现文档规范违反或需要修改的维护性问题。依据 AGENTS.md、CONTEXT.md 和相关 ADR；0 项遗留。

## Spec

规格审查发现的三项测试隔离问题已全部修复并复核：不复用身份未知的网站；拒绝可覆盖数据库目标的连接协议/参数；显式空 R2 环境阻止 Next 重载真实凭据。0 项代码审查遗留；上述真实环境验收仍未完成。

审查汇总：Standards 0 项遗留；Spec 3 项已修复、0 项代码遗留。

## 本机运行环境处理

开始时 Docker Desktop 因残留 Ingest、Inference、Secrets Engine socket 无法启动。通过 WSL 隔离这些运行时 socket 后恢复 Docker API `29.7.2`，没有恢复出厂、删除原有镜像或清空原有数据卷。这是本机环境修复，不是应用变更。
