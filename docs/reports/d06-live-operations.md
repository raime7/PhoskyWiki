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

## 部署准备与剩余验收

已准备独立受 forced-command 限制的 `phoskydeploy` 身份、发布 SSH 密钥与 GitHub secrets，以及宿主 Node 24.14.0 和 gh。尚未安装未验证的发布脚本或切换应用，等待 D04 最终通过 CI 的 main 产物。

仍需部署 D06 镜像/数据库迁移/搜索 timer/采集器，执行生产搜索校对，更新真实 R2 保留与容量回执；阈值事件邮件、整机停止、资源峰值、实际日志轮转、证书续期与费用提醒尚未完成。本报告不关闭 #40 或宣称 D07 试运行验收通过。
