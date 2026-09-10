# D06 生产邮件与故障演练记录

日期：2026-09-10。所有时间为 UTC（北京时间加八小时）。维护者明确授权生产部署和真实邮件演练，并选择自行查看 GitHub 通知邮箱。邮箱地址与凭据不写入报告。

## 环境与边界

公网：<https://phoskywiki.org>。演练时应用仍为 `ede4c192774715ddde44718437e05ae7d2c237e5`，镜像 `sha256:74b91553c0d0dd91f1c6ceff3a501dbbb28bcaf2d964591000f1c1a96f8b1878`。新 D06 应用及迁移尚待 D04 合格发布产物；本记录不能证明新版搜索维护已部署。

以下通知由服务器外的 GitHub Actions 检查产生。每轮手动 dispatch 立即检查，不能据此推导常规定时调度的最坏发现时间。邮件到达的精确时间未采集，只记录维护者明确确认收件。恢复有监控成功及 Issue 自动关闭证据，未单独确认恢复邮件收件。

## 实测结果

| 场景 | 故障与发现 | 恢复 | 邮件 |
| --- | --- | --- | --- |
| 通知通道演练 | 07:47:45 dispatch；07:48:04 创建 [#43](https://github.com/raime7/PhoskyWiki/issues/43)，`DRILL_SIMULATED_FAILURE`；未停止生产 | [恢复运行](https://github.com/raime7/PhoskyWiki/actions/runs/34452348035) 成功，Issue 关闭 | 维护者确认收到 #43 |
| 备份定时器停止 | 07:51:51 停止真实 timer；07:52:07 外部检查结束，`BACKUP_TIMER_STOPPED`，[#44](https://github.com/raime7/PhoskyWiki/issues/44) | 07:53:13 timer 恢复 active；07:53:26 Issue 关闭，[恢复运行](https://github.com/raime7/PhoskyWiki/actions/runs/34452232131) 成功 | 维护者确认收到 #44 |
| 备份服务失败 | 07:55:46 用临时 systemd ExecStart=/usr/bin/false 令真实服务失败，随后立即移除 override；[检查运行](https://github.com/raime7/PhoskyWiki/actions/runs/34452454413) 发现 `BACKUP_FAILED`，[#45](https://github.com/raime7/PhoskyWiki/issues/45) | 07:59:07 重新执行真实备份及完整校验成功，Result=success、timer active；07:59:48 Issue 关闭，[恢复运行](https://github.com/raime7/PhoskyWiki/actions/runs/34452765177) 成功 | 维护者确认收到 #45 |
| 应用停站 | 08:00:15 停止 app 容器，公网 healthz 实测 502；08:00:34 创建 [#46](https://github.com/raime7/PhoskyWiki/issues/46)，`SITE_HEALTH_FAILED,LOGIN_UNAVAILABLE,CONTAINER_UNHEALTHY` | 08:01:06 容器 healthy、公网 healthz 200；08:01:55 Issue 关闭，[恢复运行](https://github.com/raime7/PhoskyWiki/actions/runs/34452958329) | 维护者确认收到 #46 |

停止 timer 前设置五分钟自动恢复；备份失败设置五分钟真实备份重试；停 app 前设置两分钟自动启动。人工恢复完成后均停止兜底 timer。备份失败演练未修改对象存储凭据或已有恢复点；成功恢复后的新点为 `7cac0c78-40fc-4d61-86f6-67dcdd76ef9e`，snapshotAt=`1789027143594`、verifiedAt=`1789027147560`。

备份失败是实际 systemd 服务失败，不等同于 R2 故障。应用中断至确认健康约 51 秒（含启动与检查等待），不是整机断电恢复演练。未删除业务内容或回滚数据库。

通知通道首次恢复运行 [34452036701](https://github.com/raime7/PhoskyWiki/actions/runs/34452036701) 曾因 `SITE_UNREACHABLE` 失败；同期另行公网检查正常，后续恢复运行成功。保留该瞬时外部请求失败，不将首次恢复记作通过。

## 生产部署

通过 [受控发布运行 34458630678](https://github.com/raime7/PhoskyWiki/actions/runs/34458630678) 部署成功。应用为 `e52832c5609a70e89043b555e2a695f39a15f195`，来源为 main CI `34455454444` attempt 1 的合格收据；固定镜像为 `ghcr.io/raime7/phoskywiki@sha256:7277ea092bc3d44f4c30737da8e0acc6ae8562898ba06cc0fbdb866b860d7318`，测试过的 config digest 为 `sha256:c4fd8a003047261837706ab16d5ccb480efaac1dbf0d8a9bcc81f4527454501c`。

发布停写开始于 09:05:09.490，09:05:23.511 完成，入口向上取整记录中断 **15 秒**，达到十分钟目标。停写后创建并完整验证恢复点 `261099cc-d3a5-4ac4-b33c-3ffdbe9a4323`，迁移成功（16 → 18 条，新增 0016/0017），新容器 healthy，固定新镜像与备份 appRevision 已持久化。新增迁移使自动回退不兼容，本次未回退或导入旧备份。

主机发布入口独立于应用：`release.mjs` 使用受审查的 `6816ef560e5f109ef656dfc64d6e8d309df8739e`，`release-migrations.mjs` 使用 `d0803cd`；监控、备份 runner、搜索 unit 和 maintenance Compose 来自应用提交 e52832c。`phoskydeploy` forced-command、root 文件权限、拒绝任意 SSH shell 已实际验证；没有持久保存 workflow GitHub token。

前三次发布均在停写前拒绝，完整保留失败记录：旧 runtime 缺少 production 标识；Docker 29 containerd 的 manifest ID 与经典 Docker config ID 语义不同；Windows 旧镜像与 Linux 新镜像历史 SQL 换行不同。分别补齐 runtime 和 backup runtime 一致配置、严格校验固定 manifest 的 config digest、采用逐文件审查过的 13 对哈希别名解决。实际账本为早期 LF 与最后一次 CRLF 混合；未修改数据库旧账本。正确收据/账本通过，错误 config digest/未知迁移哈希拒绝，未来 LF 镜像兼容在内存模拟验证通过。

脱敏主机发布记录、运行状态、备份/保留回执及搜索指标见 [生产部署 JSON](d06-production-deployment.json)，历史文件与账本证据见 [文件哈希](d06-legacy-migration-hashes.json) 和 [迁移账本](d06-legacy-migration-ledger.json)。

## 部署后验证

- 搜索校对实际成功，indexed=1、peakRssBytes=132898816（约 127 MiB）；公开 `/api/search?q=编委会` 返回唯一既有编委会页面。未添加演示内容。搜索 available=true、degraded=false、lastReindexResult=success。
- 搜索六小时 timer 与备份十二小时 timer 均 enabled/active；新版两个 service 手动运行 Result=success。新版备份恢复点为 `39c80f04-09ea-4e67-8e14-66fb7a589d89`，已完整校验。工作完成后专用维护容器由正常路径清理；强制超时清理仍未在生产注入验证。
- 真实 R2 保留任务成功：10 个恢复点、681034 字节、删除 0 对象、共享图片保留；新容量回执已上传。Windows 每日保留任务上次结果为 0，下次计划 2026-09-11 09:20 北京时间。
- 公网 `/healthz` 200、`/login` 200、未登录 `/api/admin/search/status` 401。新采集器显示全部容器健康、restartCount=0、日志配置符合 10m/3 文件；磁盘约 32.4%、内存约 37.5%，这是一次采样，不代表组合峰值。
- [新版外部监控 34458858037](https://github.com/raime7/PhoskyWiki/actions/runs/34458858037) 成功。
- 容量阈值演练将原先未设置的 `MONITOR_BACKUP_BYTES_LIMIT` 临时设为 1，使用真实容量采样触发 [#58](https://github.com/raime7/PhoskyWiki/issues/58) 的 `BACKUP_CAPACITY`（[运行](https://github.com/raime7/PhoskyWiki/actions/runs/34458959646)）；随后删除临时变量，恢复默认 10 GiB。[恢复检查](https://github.com/raime7/PhoskyWiki/actions/runs/34459039822) 成功，09:11:44 Issue 自动关闭。维护者随后明确确认收到 #58 邮件，至此五轮告警邮件均确认收件。本演练不表示实际超出费用预算。

## 剩余验收

整机停止、其他资源/过期/证书阈值邮件、2 GB 主机组合资源峰值、实际日志文件滚动、源站证书续期、费用提醒和生产强制超时清理尚未完成。本报告不关闭 #40 或宣称 D07 全部试运行验收通过。
