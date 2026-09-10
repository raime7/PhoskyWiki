# D05：写入、图片配额与暂存维护

对应 [#39](https://github.com/raime7/PhoskyWiki/issues/39)，父规格 [#34](https://github.com/raime7/PhoskyWiki/issues/34)。以下为可配置技术默认值；上线前先运行数据库迁移 `0016`，再启动应用。无新 Redis 服务。

## 限额定义

| 配置 | 默认值 | 单位、范围与响应 |
| --- | --- | --- |
| `WRITE_LIMIT_COUNT` / `WRITE_LIMIT_SECONDS` | 60 / 60 | 每个已认证账号，窗口内最多 60 次业务写入尝试；超限 429，`code=write_rate` |
| `UPLOAD_LIMIT_COUNT` / `UPLOAD_LIMIT_SECONDS` | 20 / 3600 | 每账号每窗口最多 20 次申请上传尝试；超限 429，`code=upload_rate` |
| `COMPLETE_LIMIT_COUNT` / `COMPLETE_LIMIT_SECONDS` | 60 / 60 | 每账号每窗口最多 60 次完成上传尝试（含幂等重试）；超限 429，`code=complete_rate` |
| `UPLOAD_FILE_BYTES` | 10485760 | 单文件声明/完成字节上限，可调低，不能超过现有 10 MiB 上限；非法文件返回 400 |
| `UPLOAD_ACCOUNT_BYTES` | 1073741824 | 每账号永久图片加未清理待完成上传的声明字节，共 1 GiB；容量不足 429，`code=upload_bytes` |
| `UPLOAD_PENDING_COUNT` | 20 | 每账号同时未完成且未清理的申请数量；超限 429，`code=upload_pending` |
| `UPLOAD_STAGING_SECONDS` | 86400 | 申请创建后的暂存有效期，秒；最低实际值 3600，过期完成返回 410 |

所有配置必须为正安全整数；除账号总字节（允许到 JS 最大安全整数）、单文件（10 MiB）外，最大值为 2147483647。无效频率配置返回脱敏 503，无效上传配额配置通过现有存储错误响应返回脱敏 503，不会静默取消限制。所有角色含管理员均受限。修改配置后应统一重启所有应用进程；不同进程不得使用不同配置。

计数窗口从该账号该类操作的第一次请求开始，用 PostgreSQL 时钟计算，过期后的第一次请求开启下一窗口。数据库 UPSERT 原子累计，多进程/并发共享同一行，重启不会重置。窗口内被拒请求不会延长窗口。频率 429 带整数秒 `Retry-After`；容量/待完成数 429 没有虚构的自动恢复时间。所有限流响应 `private, no-store`。

业务写入包括提交、讨论发言、兴趣保存、通知已读，以及管理员审核、导入、删除/恢复、置顶、讨论管理、搜索重建和邀请/恢复管理。管理员统一在身份准入后计数；普通编者各写接口在会话校验后、解析请求体前计数。图片申请与完成使用各自独立窗口。认证注册/登录的既有限流保持原样，公开阅读和私图读取不消耗写额度。

频率按请求尝试计算：通过身份准入后，即使 JSON 无效、资源不存在、存储失败或容量不足，也消耗一个名额；未登录/无管理员权限请求不占其他账号额度。配额按成功创建的上传申请预留，每次申请先锁定真实账号行，在同一事务计算并插入。客户端 `uploadedBy`、`x-user-id`、转发头、IP、路径变化都不能改变账号身份；两个账号共用 IP 不共用业务额度。正常完成/重复完成不会再预留容量。私图、驳回提交使用的图片、历史修订图片均计入永久容量，不能通过取消引用释放容量。

## 完成与清理

保留 PNG/JPEG/WebP/GIF 类型检查、声明与对象元数据相等校验、条件复制冻结、审核公开与私图权限。预签名 PUT 有效期仍为 300 秒；永久 key 不签发 PUT。完成请求先锁图片行，仅首次成功时复制；冻结之后重放暂存 PUT 或完成请求均不改变永久内容。调整单文件上限作用于新申请，已有申请仍按创建时已验证的声明大小完成。

维护入口不加载 `.env`，需显式注入 `DATABASE_URL`、`PHOSKYWIKI_ENV`，清理另需 `R2_*`。数据库目标包含主机、端口、库名、用户名，连接后再次校验数据库身份；存储目标同时确认 endpoint 和 bucket。以下参数换成实际目标，凭据通过受保护运行配置注入，不能放进命令行：

```sh
node --conditions=react-server --import=tsx scripts/images.ts usage \
  --environment production --target postgres:5432/phoskywiki/phosky

node --conditions=react-server --import=tsx scripts/images.ts cleanup \
  --environment production --target postgres:5432/phoskywiki/phosky \
  --endpoint https://ACCOUNT.r2.cloudflarestorage.com --bucket PRIVATE_BUCKET

# 核对 dry-run 后添加 --apply；每批默认 500，--batch 允许 1–10000。
node --conditions=react-server --import=tsx scripts/images.ts cleanup \
  --environment production --target postgres:5432/phoskywiki/phosky \
  --endpoint https://ACCOUNT.r2.cloudflarestorage.com --bucket PRIVATE_BUCKET --apply
```

清理只选择创建时间超过暂存有效期的数据库记录，并在图片行锁内重新检查条件。删除接口只允许 `staging/<UUID>`，没有删除永久对象的入口。成功删除暂存后，未完成上传标记过期并释放账号预留；完成的图片只更新暂存清理时间。永久图片及其元数据永不删除，历史修订和待审引用继续可用。清理失败不释放预留，进程返回非零并报告失败数量。清理与完成竞争由同一图片行锁串行化。

保留过期记录，每小时可以再次扫描已清理 key：签名到期前开始的请求可能在删除后才完成，保留记录才能清理这种迟到的对象。最近一小时已扫描的记录会被跳过，避免紧密循环重复发删除请求。`batchFull=true` 表示可能仍有候选；按批继续到 false，后续按小时运行。应把非零退出、清理持续落后接入 D06 告警；D07 负责生产调度启用与实际复验。

不对永久目录设置过期生命周期。崩溃可能留下复制成功但数据库未提交的孤立永久对象，本任务保守保留；不得仅凭“当前页面无引用”删除它们。清理数据库事务与对象存储不是分布式事务，因此删除成功但事务失败时允许下一次重试。暂存 key 保留与永久目录保守保留都有存储/请求成本。

## 运维用量与费用风险

`usage` 和 `cleanup` 输出 JSON：永久图片数/声明字节、待完成数/预留字节、从未清理的过期暂存数量、过期申请数，以及按操作分类的累计准入/拒绝次数。大字节和累计次数用十进制字符串输出，避免 JSON 整数精度损失。准入次数是进入后续处理的尝试数，不等于成功写入/上传数；账号删除会级联删除其计数，恢复备份会恢复当时计数，因此只适合区间观测。报告不含账号、文件名、会话、密钥或签名链接。

单文件完成校验的 **10 MiB 不是 R2 接收流量或账单硬上限**：客户端可向同一暂存 key 上传更大文件，或在签名有效期内重复 PUT；这些字节即使不能完成也可能产生费用。预留依据客户端声明且冻结时才核验，不是供应商的收款上限。

每小时观察清理失败/落后、待完成数、永久字节增长和拒绝次数。每天同时检查 Cloudflare R2 的实际存储字节、Class A/B 请求量和账单，给出适合账户预算的告警阈值。应用报告明确 `providerBillingMeasured=false`，不计算没有供应商依据的美元费用；孤立永久对象、暂存实际大小、重复 PUT/GET、失败尝试及其他工具操作必须以供应商指标补足。R2 权限、签名机制参考 [官方文档](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)。

生产日志只收集脱敏错误和聚合报告。不要打印 SDK 原始错误、Request/Response headers、有效签名 URL；代理日志也应隐藏查询字符串及 Cookie/Authorization。真实 Cloudflare → Caddy → Next.js 的认证 IP 信任链、伪造转发头和缓存仍需 D07 在部署环境复验；业务限额只用数据库会话里的账号 ID。

生产容器可使用同一受保护 runtime 配置运行：`docker compose -f compose.production.yml run --rm --no-deps app images usage --environment production --target postgres:5432/phoskywiki/phosky`。清理时将 `usage` 换为 `cleanup` 并提供上述 endpoint、bucket 和可选 `--apply`；容器入口同时传入所有限额配置。

## 验证入口

使用 `docs/production.md` 的隔离 PostgreSQL：

```sh
pnpm exec vitest run tests/integration/write-limits.test.ts tests/integration/image-limits.test.ts tests/integration/image-maintenance.test.ts tests/integration/production.test.ts
pnpm exec playwright test tests/e2e/write-limits.spec.ts --workers=1
```

真实 R2 契约要求 `R2_CONTRACT_ENDPOINT`、`R2_CONTRACT_BUCKET`、`R2_CONTRACT_ACCESS_KEY_ID`、`R2_CONTRACT_SECRET_ACCESS_KEY`，桶必须以 `-test` 结尾且不同于应用桶：

```sh
pnpm exec vitest run tests/integration/r2-object-store.contract.test.ts
pnpm exec playwright test --config playwright.r2.config.ts --output=playwright/.cache/d05-r2
```

缺少真实凭据时该契约明确跳过，不算通过。D05 的真实桶为 `phoskywiki-d05-test`；测试对象用随机 key，并在 finally 删除本次创建的对象。生产桶 `phoskywiki-images`、备份桶均不用于本测试。

专用浏览器配置缺凭据直接失败，正常浏览器配置仍清空应用 R2 凭据；只有专用入口把已验证的 `R2_CONTRACT_*` 传给子服务器。使用端口 3000 或 3105（后者设 `PW_PORT=3105`），与 MCP 配置的测试桶 CORS 一致。测试关闭 trace、截图与视频以免保存签名响应。运行前准备隔离数据库的迁移与种子，不能与其他清库测试同时运行。
