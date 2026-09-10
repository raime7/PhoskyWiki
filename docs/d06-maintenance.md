# D06：定时维护与故障通知

本手册对应 #40。PostgreSQL 是内容事实来源，Meilisearch 是可重建的派生索引。`/healthz` 仍只做一次数据库查询；数据库健康不代表搜索、图片或备份健康。

## 搜索检查和校对

管理员 `GET /api/admin/search/status` 返回脱敏的 `available`、`degraded`、最近失败时间、最近成功校对时间和结果。禁止共享缓存；未登录/非管理员不能读取。增量同步失败不会撤销已发布内容，故障状态持久化到数据库，应用重启不会清掉。成功的单次增量不能清除旧故障，只有完整校对成功才清除。

运行环境内的等价命令（加载受保护的 `/etc/phoskywiki/deployment.env`，不复制秘密到命令行）：

```sh
set -a
. /etc/phoskywiki/deployment.env
set +a
docker compose -f compose.production.yml --profile ops run --rm -T --no-deps ops search-status --target postgres:5432/phoskywiki/phosky --search http://meilisearch:7700/pages
docker compose -f compose.production.yml -f compose.maintenance.yml --profile ops run --rm -T --no-deps ops reindex --target postgres:5432/phoskywiki/phosky --search http://meilisearch:7700/pages
```

本地 `pnpm search:reindex` 同样要求显式 `DATABASE_URL`、`MEILI_HOST`、`MEILI_MASTER_KEY`、`MEILI_INDEX_UID` 和匹配的 `--target`/`--search`；不再自动读取 `.env`。缺配置、目标不符、数据库身份不符均在索引修改前失败。命令完成输出 indexed、peakRssBytes；错误非零退出，原始数据库或搜索异常不输出到日志。`search-status` 是采样命令：成功采样退出 0，但必须继续检查 JSON 的 `ok` 和 `search`；读取失败非零退出。

管理员手动重建与命令使用同一个 PostgreSQL advisory lock。重叠重建拒绝执行；增量同步等待重建释放锁再从 PG 读当前内容，等待超过 15 秒则记录待校对故障。成功重建只清除其开始前的失败，之后发生的漏同步继续保留 degraded；比较采用数据库时间，避免不同进程时钟偏差。锁连接池独立且最多两个连接，避免占满内容查询池。进程退出后锁自动释放。重建开始前写入 running/degraded，因此中途被杀不会留下健康状态。重建可能暂时清空搜索结果；PG 公开读路径仍校验每条命中的可见性。

搜索故障排查顺序：检查 `/healthz` → 管理员状态 → Meilisearch 容器健康/内存 → 校对 service 日志 → 用公开 `/api/search?q=已知词条` 验证词条、视角、讨论。不可用与漂移不同：服务恢复可访问后，之前漏掉的文档仍需重建。索引只包含已公开内容；待审提交、软删除页面/楼层及不可见父页面下的视角不得恢复进公开结果。

## 调度安装

先部署含 migration 0017 的固定应用镜像并迁移，运行新版保留清理刷新含 backupBytes 的回执，再更新监控采集器，最后启用 timer。混用旧镜像或旧回执会报告状态不可用，不能把它当成健康。

```sh
install -m 0644 deploy/phoskywiki-search.service deploy/phoskywiki-search.timer /etc/systemd/system/
install -m 0644 deploy/phoskywiki-backup.service deploy/phoskywiki-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl start phoskywiki-search.service
systemctl start phoskywiki-backup.service
systemctl enable --now phoskywiki-search.timer phoskywiki-backup.timer
systemctl list-timers 'phoskywiki-*'
journalctl -u phoskywiki-search.service -u phoskywiki-backup.service --since today
```

脚本位于 `/opt/phoskywiki`，受保护配置在 `/etc/phoskywiki/deployment.env`；同时安装本仓库 `compose.maintenance.yml` 和备份 runner。搜索每六小时 UTC 03/09/15/21 点执行，错过后补跑，最多随机延后五分钟。与 UTC 00/12 点备份共用宿主锁，避免资源峰值重叠。锁冲突非零退出，管理员可核实持锁任务后重试。

搜索任务使用 ops 镜像，Node 堆 256 MB、容器内存 384 MB、CPU 0.5；Meilisearch 仍为 128 MB 索引预算、单索引线程、384 MB 容器上限。20 分钟超时会删除该 service 专属的 `phoskywiki-search-reconcile` 容器，不能复用此名字运行别的工作。这些是上限配置，2 GB 主机组合峰值仍须在 D07 实测。

## 备份、保留和图片

备份每十二小时创建一次，并完整下载、解密、核验后才写 `/var/lib/phoskywiki/backup.json`。年龄按创建开始时刻计算，不能用校验结束时间掩盖旧快照。任何创建/校验失败使 service 失败且保留上次完整回执。

定时备份使用专属容器名 `phoskywiki-scheduled-backup`。runner 在退出/超时后删除此容器，systemd 的 ExecStopPost 也兜底清理，避免 Compose 客户端结束后后台备份仍运行。此名称不用于其他手动作业。

`scripts/backup-retention.mjs` 默认只输出计划，显式 `--apply` 才删除。保留最近 14 天全部恢复点，另外保留最近四个有恢复点的 UTC 自然周各一份。清单认证失败、无 18 小时内的新恢复点、错误桶或异常元数据均拒绝删除。只删除过期恢复点私有文件，所有共享图片保守保留，因此不会删除仍被内容或恢复点引用的图片，也不保证自动回收全部空间。禁止给共享图片设置按年龄删除的生命周期规则。

维护者本机每日运行 `deploy/backup-retention.ps1`，清理凭据不放源服务器。成功上传 retention.json 回执；超过三天无成功回执告警。已有 Windows 定时任务的运行身份、登录条件和联网必须核实。关闭维护者电脑不会影响服务器备份，但会停止保留清理。

新维护电脑安装时可在仓库根目录注册每日 09:20 任务（需要已配置其受保护凭据和 SSH known_hosts；当前用户登录时运行）：

```powershell
$script = (Resolve-Path deploy/backup-retention.ps1).Path
$action = New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument "-NoProfile -NonInteractive -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At '09:20'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'PhoskyWiki Backup Retention' -Action $action -Trigger $trigger -Settings $settings
Get-ScheduledTaskInfo -TaskName 'PhoskyWiki Backup Retention'
```

图片上传/读取使用独立验收（见 write-and-upload-limits.md）；`/healthz` 和搜索检查不能证明 R2 可用。D07 已启用每小时暂存清理，提供失败、停止与三小时回执过期信号；安装、监控发布顺序和实测状态见 [D07 手册](d07-operations.md) 与 [报告](reports/d07-implementation.md)。

## 外部告警和邮箱

`Production monitor` 在 GitHub Actions 每半小时运行，探测 HTTPS `/healthz`、`/login`、公网证书，并通过受限 SSH 命令获取主机状态。监控私钥只能运行 `deploy/phoskywiki-monitor-status.py`，使用 `restrict,command="…"`，禁止 shell 和转发；固定服务器 known_hosts。配置 `PRODUCTION_MONITOR_KEY` 和 `PRODUCTION_MONITOR_HOSTS`，核对 workflow 中的目标；不要将运维私钥替代监控密钥。

监控公钥使用 `restrict,command="/usr/bin/python3 /opt/phoskywiki/deploy/phoskywiki-monitor-status.py"` 前缀安装；脚本由 root 所有且不可被普通用户修改。通过该身份执行任何命令都只能返回脱敏 JSON，部署后验证 shell/转发不可用。

| 信号 | 默认阈值/判定 |
| --- | --- |
| 站点完全停止/健康接口异常/登录不可用 | 外部探测失败或非 200 |
| 状态采样无效或不可达 | 缺字段、超时、采样超过 5 分钟或时间异常 |
| 备份失败/调度停止 | service Result 非 success / timer 不 active |
| 恢复点过期 | 18 小时预警；24 小时 RPO 超限 |
| 搜索不可用/增量遗漏 | 实际查询失败 / PG 持久化 degraded |
| 校对失败/任务消失 | service 失败、timer 停止、12 小时无成功校对 |
| 磁盘/内存 | 使用率达到 85% / 90% |
| 容器反复重启 | 任一容器自创建以来 RestartCount 达到 3；不是滚动时间窗 |
| 日志轮转 | 实际容器不是 json-file / 10m / 3 文件 |
| 公网证书 | 14 天内到期，或 TLS 验证失败；源站证书另行检查 |
| 保留清理停止 | 三天无成功回执 |
| 备份容量 | 保留清理扫描整个备份前缀（含共享图片），达到默认 10 GiB 告警；可通过 MONITOR_BACKUP_BYTES_LIMIT 调整 |

默认值在脚本/单元文件中集中维护；调整后重跑测试并记录新阈值。10 GiB 为可配置技术提醒值，不代表用户已批准预算或费用上限。容量值为最近一次清理前的扫描值，非实时账单；回执过期单独告警。异常按故障代码集合去重；新增/变化/恢复才创建或评论 GitHub Issue，恢复后关闭。告警只写代码与 CI 链接，不包含连接串、页面正文、签名链接、收件邮箱或原始异常。

GitHub 邮件是当前已有通知方案。维护者在 GitHub 账号中配置实际收件邮箱、订阅仓库及 Actions 失败通知。仅创建 Issue 不证明收到邮件。未获发送/收件授权时，不执行 workflow 通知演练。获授权后先运行独立 drill=failure/recovery，再逐一在隔离服务器测试真实停止、备份失败、停止 timer、过期回执、资源/证书阈值。记录收件时间与消息对应代码；模拟 drill 不能代替真实故障。

GitHub 调度可能延迟或停止；本监控不能检测自身调度器整体失效，不能承诺立即邮件或固定发现上界。维护者每周检查最近运行时间；如需独立兜底，接入第二家外部 dead-man 服务并单独授权通知。主服务器完全停机可以被 GitHub 外部探测发现；这与 GitHub 自己停调是两个故障。

## 日常维护清单

| 周期 | 操作与完成证据 |
| --- | --- |
| 每周 | 查告警和最新备份/校对；审依赖更新 PR、运行 CI 后主动发布；查磁盘、重启、日志轮转与 GitHub 调度最近运行 |
| 每月 | 在独立空环境恢复数据库/图片/账号/搜索；验证加密离线副本与独立恢复密钥；记录耗时与副本位置 |
| 每月账单 | 核对 Vultr、R2 存储/操作数、备份增长及预计月费；维护者设定批准预算，达到 80% 预警/100% 处理，接入供应商可用的账单提醒或日历提醒。未配置实际预算和提醒前此项未完成；提醒不是硬封顶 |
| 域名/证书 | 在受保护台账记录注册商、续费日期、自动续费及付款方式；到期前 60/30/7 天提醒；查公网和源站证书及续期日志 |
| MFA/恢复 | 核对 GitHub、Cloudflare、Vultr、注册商 MFA 与恢复码位置；验证维护者可在原服务器失联时取回资料 |
| 密钥轮换 | DNS、图片、备份写入、清理、发布、监控分开轮换；先验证新密钥，再撤销旧密钥，实际验证旧密钥失效；更新独立密码库及离线资料 |
| 维护者缺席 | 明确代班人/联系途径、最长不可响应时段与受控恢复资料获取方法；无人代班则记录 12 小时响应假设不成立，不作 24 小时恢复承诺 |

Docker 日志轮转通过真实 inspect 采样；systemd 日志还应设置 journald `SystemMaxUse=200M`、`MaxRetentionSec=14day` 并检查 `journalctl --disk-usage`。这些配置不会自动清理应用另行写到磁盘的文件。

每次故障在受保护台账记录 UTC 的 `failureStartedAt`、`detectedAt`、`emailReceivedAt`、`acknowledgedAt`、`recoveryStartedAt`、`publicVerifiedAt`，以及提交/digest、环境、故障代码。分别计算发现、邮件延迟、人工响应、恢复操作和总中断；总时长从故障开始到公网验证结束，不能只算数据库导入。未测字段标“未验证”，供 D07 的 24 小时目标验收使用。
