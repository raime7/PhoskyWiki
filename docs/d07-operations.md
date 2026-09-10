# D07：公开试运行运维手册

适用站点 `https://phoskywiki.org`，Vultr 首尔 1 vCPU / 2 GB。PostgreSQL 为内容事实来源，Meilisearch 可重建，永久图片与历史修订不可按年龄删除。实际验收与未完成项见 [D07 报告](reports/d07-implementation.md)；本手册不代表所有验收通过。

## 网络与证书

Cloudflare 的 apex A 指向源站并开启代理，`www` 为代理 CNAME，SSL 为 Full (strict)。Caddy 将 HTTP 和 www 以 308 跳转主域并保留路径/查询。动态页面、认证、审核和图片请求使用 Cloudflare `http_request_cache_settings` 规则绕过共享缓存，仅 `/_next/static/` 留给默认静态缓存策略。不要添加覆盖它的 Cache Everything 规则。

`deploy/Dockerfile.caddy` 固定 Caddy 2.11.2 和 Cloudflare DNS 模块 0.2.4；在构建机运行，不能在小型生产主机编译。应用继续使用 D04 合格镜像。代理镜像独立验证：

```powershell
docker build -f deploy/Dockerfile.caddy -t phoskywiki-caddy:reviewed deploy
$env:TEST_CADDY_IMAGE='phoskywiki-caddy:reviewed'
node scripts/test-public-proxy.mjs
```

将测试过的镜像按摘要传输/发布，核对归档 SHA-256 和平台实际 image ID，在受保护的 `/etc/phoskywiki/deployment.env` 设置 `CADDY_IMAGE=sha256:…`。containerd 的 manifest/index ID 与传统 Docker config ID 可能不同，须核对同一归档/manifest 到 config 的关联，不能忽略不一致。应用发布不得顺带更换代理。

仅限本站 zone 的 `Zone Read + DNS Write` 令牌保存为 `/etc/phoskywiki/secrets/cloudflare-dns-token`，root 所有、0600。本机恢复副本位于维护者受保护目录的 `cloudflare-dns-token.txt`。账号级令牌管理凭据只留本机。`caddy-entrypoint.sh` 在进程内加载令牌；禁止把令牌写进 Compose、命令参数、日志或 Git。Caddy 关闭配置持久化与访问日志，不能开启包含签名查询的访问日志。证书数据保存在 `caddy_data` 卷。

安装新版 `compose.public.yml`、`deploy/Caddyfile.public`、`deploy/caddy-entrypoint.sh`、`deploy/cloudflare-cidrs.txt` 前，备份旧文件与 deployment.env 到 root-only 目录。先验证配置，再在预告维护窗口替换 proxy；公网 `/healthz`、`/login` 和 www 必须成功。失败恢复旧配置和旧代理镜像，禁止恢复数据库。发布依然通过 [D04 手册](releases.md)；每周依赖更新经过 CI 后主动发布。

```sh
cd /opt/phoskywiki
set -a
. /etc/phoskywiki/deployment.env
set +a
docker compose -f compose.production.yml -f compose.public.yml run --rm --no-deps proxy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -f compose.production.yml -f compose.public.yml up -d --no-deps --force-recreate --wait proxy
```

配置文件 bind mount 原位更新后，即使 Compose 判定无需重建，Caddy 也不会自动重读。需显式 `--force-recreate`，或确认新容器确实读取新配置。`admin off` 不支持 `caddy reload`。

DNS-01 不依赖公网 ACME HTTP 入口。每月检查源站证书到期及 `tls.obtain` / `tls.renew` 结果，验证令牌仍能读取本站 zone、创建并删除专用 TXT 记录。更换令牌时先验证新令牌，再替换受保护文件并重启代理，最后撤销旧令牌并实测其 DNS 请求失败。首次成功签发不等于已观察完整自动续期周期。

## 源站与 SSH

Cloudflare CIDR 清单来自 [官方 IPv4](https://www.cloudflare.com/ips-v4) 和 [IPv6](https://www.cloudflare.com/ips-v6)，当前快照日期 2026-09-10。同一文件供 Caddy peer 校验和 nftables 使用。更新前核对官方列表，验证新配置，安排自动回退，再应用防火墙并重建 proxy；不能只更新一端。

```sh
install -m 0644 deploy/phoskywiki-origin-firewall.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now phoskywiki-origin-firewall.service
python3 deploy/phoskywiki-origin-firewall.py
```

脚本只管理 `inet phoskywiki_origin` 表，针对默认路由网卡在 Docker DNAT 前过滤 TCP 80/443，两种地址族均配置。重复应用为原子替换；不清空其他防火墙表，不修改 SSH。首次操作应先用 `systemd-run --on-active=180s` 安排删除这张表的回退，外部 HTTPS 与独立 SSH 验证成功后取消 timer。需要恢复时仅执行 `nft delete table inet phoskywiki_origin`，修复配置后重启该 service。主机重启后的规则恢复仍须纳入月度演练；Caddy 的来源检查为独立防线。

应用/PG/搜索不发布宿主端口。宿主 `127.0.0.1:8080` 仅支持 GET/HEAD `/healthz`，不能当作登录或写入入口。公网客户端来源由可信 Cloudflare peer 的 `CF-Connecting-IP` 解析，再覆写 `X-Forwarded-For`/`X-Real-IP`；客户端提供的链条不会传给认证限流。来源策略依据 [Caddy 官方选项](https://caddyserver.com/docs/caddyfile/options#trusted-proxies)。

维护者、发布、监控使用不同 SSH 密钥，固定 known_hosts。发布和监控身份只能执行各自 forced command。维护者 root 密钥是独立运维通道；不要以来源白名单封死唯一恢复入口。主机密码登录现状和供应商控制台恢复测试见报告，不把 forced command 等同于整个 SSH 已完成加固。

## 每小时暂存清理

安装 `phoskywiki-staging-run.py` 及 service/timer 后执行：

```sh
install -m 0644 deploy/phoskywiki-staging.service deploy/phoskywiki-staging.timer /etc/systemd/system/
systemctl daemon-reload
systemctl start phoskywiki-staging.service
systemctl enable --now phoskywiki-staging.timer
systemctl show phoskywiki-staging.service --property=Result
```

每小时 UTC 25 分运行，随机延后最多五分钟；错过后补跑。与备份、搜索共用宿主锁。固定生产数据库身份、环境和图片桶，调用 D05 实际清理 CLI，每批 500 条，最多 100 批/18 分钟，systemd 20 分钟兜底。命令失败或仍有积压均不刷新 `/var/lib/phoskywiki/staging.json`；只在排空当次候选后原子写成功回执。清理仅删除 staging，对已冻结图片保持原有保护。

失败先查目标、R2 连通性和 `journalctl -u phoskywiki-staging.service`。锁冲突时确认备份/搜索状态后重试，不能删锁文件冒充解锁。专属容器 `phoskywiki-staging-cleanup` 由正常退出及 ExecStopPost 清理，不用于其他作业。

监控新增 `STAGING_CLEANUP_FAILED`、`STAGING_TIMER_STOPPED`、`STAGING_CLEANUP_STALE`（三小时无完整成功）、`STAGING_STATUS_INVALID`。先安装采集器并成功执行清理，再发布新版 monitor，避免缺字段被误报为健康。GitHub 外部调度与邮件边界见 [D06](d06-maintenance.md)。

## 日常责任与恢复

| 周期/触发 | 行动 |
| --- | --- |
| 每日 | 查看告警、最近完整备份、暂存清理、搜索状态；本机保留任务需要电脑登录联网 |
| 每周 | 审核依赖更新与固定镜像 CI，预告后主动发布；查日志容量、重启、证书、监控最近运行 |
| 每月 | 按 [备份手册](backups.md) 在空隔离环境恢复数据库、图片、账号与搜索；核对离线导出和密钥可取回 |
| 费用 | 用户于 2026-09-10 指定总费用提醒额度 US$20/月。核对 Vultr、R2、域名折算与附加费；额度是提醒，非供应商硬封顶。现有备份容量告警不是总账单告警 |
| 超过 12 小时无法响应 | 用户指定联系 Karl Aurora（QQ 邮箱管理员）。地址留在受保护账号资料；确认通知渠道、接收与代班权限后才依赖此安排 |
| 域名 | Cloudflare 注册商，已记录到期 2027-09-08；复核自动续费、付款方式与 MFA，提前 60/30/7 天检查 |
| 恢复资料 | 当前只有维护者电脑上的加密密码库/备份，没有第二设备或离线介质副本；电脑丢失的恢复风险尚未闭环 |

本次不购买第二实例。维护者此前取消替代服务器演练，采用同机隔离恢复；不把十几秒数据库/图片恢复耗时当作完整灾难 RTO。发现、邮件送达、人工响应、机器准备及公网恢复均须分别计时，完整 24 小时目标仍受这些未测条件限制。
