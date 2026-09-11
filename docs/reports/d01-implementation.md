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

最终容器测试于北京时间 10:45:35–10:48:23 执行。镜像为 `sha256:076515879e949126d35e53d72f38062700da68fef5c77d1e243b46d406b5ca42`；原始脱敏证据见 d01-container-evidence.json（本机原始证据，不随仓库分发：`d01-container-evidence.json`）。

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

上述为 2026-09-09 本地历史数据。2026-09-10 已补做下列真实环境验收，不能再将它们列为“等待采购资源”。

## 2026-09-10 真实部署与备份补验

站点为 <https://phoskywiki.org>；Vultr 首尔普通 1 vCPU / 2 GB 实例，源站 `141.164.63.81`。Cloudflare 代理 A 记录指向该源站，Full (strict)；Caddy 自动签发证书。HTTPS `/healthz` 与 `/login` 返回 200，HTTP 重定向 HTTPS，公开注册暂返回 403。两位正式管理员登录、会话、管理员角色及退出均验证成功。

应用版本 `8af127426a6f8ee78feefbb36fbf234059312e7b`，服务器镜像 `sha256:e9cae8ab7d2174b00bfde3aacc6a55bc05ae9cbd8aa50396f0556cbf2ebef2fd`。由该提交的跟踪源文件构建，未带入工作区未提交文件。传输归档 SHA-256 为 `db12639d79b66eca74e4b950e3129737ab4e81a62d1eb48c21b914b42aaee6b0`，两端校验一致。不同 Docker 镜像存储后端导入后的本地/服务器镜像 ID 不同，采用传输归档摘要及镜像 revision 标签确认同一构建。

| 实际检查 | 结果与边界 |
| --- | --- |
| 生产图片桶实际字节 | 上传/下载 68 字节 PNG，SHA-256 `9f81650ff972f04ecb98e05d93c4cc65f22fb721385b8529d3ae3c00d479f786` 一致，测试对象已删除 |
| R2 CORS | `https://phoskywiki.org` 预检 204；未授权来源 403；允许 GET/HEAD/PUT、content-type，暴露 ETag |
| 专用 R2 契约 | 真实 PUT、HEAD、条件复制、冻结副本及签名 GET 字节通过；不是元数据替代验收 |
| 备份权限隔离 | 应用凭据访问备份桶 403；源读取/备份写入分开；清理凭据只在本机。R2 写入权限包含删除，不声称不可删除 |
| 真实组合负载 | 4 个 HTTP worker，90 秒，2,024 个请求均 200，源站请求 P95 67.2 ms；同时两管理员登录、搜索重建和备份均成功 |
| 宿主同时峰值 | `MemTotal-MemAvailable` 最大 1,071,673,344 字节（约 1,022 MiB）；swap 最大 274,432 字节（约 0.26 MiB）；无容器 OOM |
| 生产恢复点 | 已加密上传独立 R2 备份桶、完整校验、下载加密离线导出；在空隔离 PG 中恢复，两位管理员原密码登录，重建搜索可查询 |
| 定时备份 | systemd 每 12 小时，启用且手动 service 返回 success/0；详见 [backups.md](../backups.md) |
| SSH | 已安装独立 Ed25519 运维公钥并实测密钥登录；指纹 `SHA256:m6mk5Kfp/DosT/5nKeEz4+S5J7pytzr31S8s0XQiLBU`。这是维护者 root 运维入口，不是受限自动发布账号 |
| 大陆拨测 | Globalping 六城市、电信/联通/移动节点：健康接口、登录页、CSS 共 18 次请求全部 200，TLS 校验均有效。登录页 0.964–3.468 秒，CSS 0.286–1.928 秒；健康接口 1.407–11.452 秒，跨境链路存在明显波动 |

原始组合负载记录见 d01-live-load.json（本机原始证据，不随仓库分发：`d01-live-load.json`），恢复点与负面契约见 d03-backup-evidence.json（本机原始证据，不随仓库分发：`d03-backup-evidence.json`）。宿主采样间隔 200 ms，可能漏掉更短峰值；cgroup 栏是生命周期峰值，不相加充当同时峰值。数据集只有初始编委会和两位管理员，生产库没有永久图片记录；真实图片契约单独运行，不能将小数据集测试推导为大容量承诺。

大陆拨测使用 [Globalping 官方 API](https://github.com/jsdelivr/globalping/blob/master/public/v1/spec.yaml)，探针元数据标记 CN/eyeball-network，分别为广州/西安电信 AS4134、武汉/长沙联通 AS4837、北京/上海移动 AS9808。原始记录见 d01-mainland-http.json（本机原始证据，不随仓库分发：`d01-mainland-http.json`） 和 d01-mainland-assets.json（本机原始证据，不随仓库分发：`d01-mainland-assets.json`）。测量 ID 保存在文件中；这些是一次性 HTTP/TLS 抽样，不是浏览器完整加载或全天可用性承诺。

**仍未关闭：**真实域名浏览器客户端导航验收及验收测试密钥撤销。浏览器控制通道出现 `nodeRepl.fetch request failed`，重置与重新打开页面后仍超时。每 12 小时备份已运行，但外部失败/过期告警、14 天及 4 周保留清理、密码管理器独立密钥托管和完整故障到恢复的 24 小时演练仍属于部署运维后续验收。此记录不声称整个部署规格完成。

本次代码验证：`pnpm test` 279 通过、1 跳过（默认不注入 R2 秘密；专用真实 R2 契约单独通过）；`pnpm typecheck`、`pnpm lint` 通过。真实备份契约覆盖增量图片复用、恰好 50,000 张图片边界拒绝、无有效 R2 凭据的离线校验、运行配置提取及故障案例。另在隔离生产恢复副本中通过 HTTP 创建正文、两条历史修订、两张真实图片，重新备份并恢复后验证正文、修订相等、公开图片字节、私有图片匿名拒绝、管理员读取和搜索。

本次 Standards 审查：0 项硬违反，1 项清单边界漂移判断项已修复。Spec 审查：数量边界、配置提取、图片增量共 3 项已修复，复核未发现阻断项。审查针对本次补充实现，不覆盖既有后续部署待办。

## Standards

并行规范审查未发现文档规范违反或需要修改的维护性问题。依据 AGENTS.md、CONTEXT.md 和相关 ADR；0 项遗留。

## Spec

规格审查发现的三项测试隔离问题已全部修复并复核：不复用身份未知的网站；拒绝可覆盖数据库目标的连接协议/参数；显式空 R2 环境阻止 Next 重载真实凭据。0 项代码审查遗留；上述真实环境验收仍未完成。

审查汇总：Standards 0 项遗留；Spec 3 项已修复、0 项代码遗留。

## 本机运行环境处理

开始时 Docker Desktop 因残留 Ingest、Inference、Secrets Engine socket 无法启动。通过 WSL 隔离这些运行时 socket 后恢复 Docker API `29.7.2`，没有恢复出厂、删除原有镜像或清空原有数据卷。这是本机环境修复，不是应用变更。

2026-09-10 Docker Desktop 再次故障；本次使用独立 Debian WSL 的 Docker 26.1.5 完成验证，未将其写成 Docker Desktop 已修复。恢复验证目录 `/tmp/phosky-production-restore-9zI86t`、`/tmp/phosky-production-restore-q4Rhpi` 及各自 UUID 容器已在 finally 清理。未新建临时仓库检出副本；构建通过流式传入跟踪源文件完成。生产回滚镜像与加密离线备份是保留的交付物，不是待删除验证副本。
