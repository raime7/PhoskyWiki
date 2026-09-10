# D02：邀请与账号恢复

范围：[D02 / #36](https://github.com/raime7/PhoskyWiki/issues/36)。登录、会话和密码散列沿用 Better Auth；所有环境关闭其直接注册接口。注册只接受本站邀请兑换入口，不存在生产测试开关。邀请不改变已有账号角色，新账号固定为普通编者且 `emailVerified=false`。双人受理沿用提交创建时的票数快照。

## 日常邀请

1. 管理员登录后打开页头「邀请与恢复」，点击「签发编者邀请」。
2. 复制仅显示一次的链接，通过双方已经确认的私下渠道交付。本站不发送邮件；页面刷新后不能找回原始令牌，需要撤销旧邀请并重新签发。
3. 受邀者打开链接，填写名称、邮箱和自己的密码。成功创建账号才消费邀请；随后自动尝试登录，网络或登录失败时可转到登录页使用已创建的账号。
4. 管理员可以在最近 100 条记录中撤销尚未使用的邀请。过期、撤销、使用过的邀请均不能再兑换。

默认邀请有效期 7 天（`INVITATION_TTL_SECONDS=604800`），恢复令牌 1 小时（`PASSWORD_RESET_TTL_SECONDS=3600`）。这是可配置技术默认值；接受 1–31536000 的整秒数，非法配置拒绝签发。配置仅影响新令牌，已签发令牌保留原有到期时间。容器可在受保护 `runtime.json` 中增加同名字符串配置，修改后重启应用。

## 人工恢复密码

1. 通过既有可信联系方式联系账号本人，并核对注册邮箱。不能仅凭“知道邮箱”或来自陌生联系人的请求签发恢复链接。涉及管理员时优先由另一位管理员核实；核实过程不等同于邮箱验证，不修改 `emailVerified`。
2. 管理员在「邀请与恢复」填写准确目标邮箱，确认已核实身份，再签发密码恢复链接。只有管理员能签发、查看记录和撤销。
3. 私下交付一次性链接；本人设置 8–128 位新密码。成功重设在同一事务中更新密码、消费恢复令牌并删除目标账号的所有数据库会话。
4. 新密码登录成功后，旧密码和旧会话不再可用。怀疑链接泄露时立即撤销；已使用的链接不能重放。重新签发不会自动撤销其他尚未使用的恢复链接，需要逐条撤销不用的链接。

邀请与恢复令牌使用独立用途的 SHA-256 摘要；数据库不保存可直接兑换的原始令牌。链接使用 `#` 片段，浏览器不会将片段发送到服务器，也不会放进 Referrer；页面和接口设置 `no-store` / `no-referrer`。不要把完整链接贴到工单、聊天群、分析服务或日志，不要开启记录认证请求体的代理/APM。复制链接仍会进入操作系统剪贴板，应按密码一样保护。兑换只接受同源 JSON POST，GET 不消费令牌。

生产环境的注册和恢复兑换沿用认证敏感入口的每来源、每路径 10 秒三次限制，超过返回 429 和 `Retry-After`。来源解析复用 Better Auth，无法识别时使用共享桶；与现有认证一样使用单进程内存计数，重启会重置。多进程部署需另配共享计数；可信代理与真实客户端来源由 D07 验收。并发登录在发出会话 cookie 前再次锁定读取凭据并校验，防止已用旧密码开始的登录跨过密码重设后留下可用会话。

## 管理员全部无法登录

由有服务器访问权的维护者执行 `recover-admin`。不依赖演示 seed、不创建账号、不提权、不清库。必须同时指定数据库目标、环境、管理员 ID 和邮箱；任何不匹配都在修改前退出。成功时还会撤销该管理员未使用的恢复令牌。缺少或异常的本地密码账号会拒绝操作，需要另行诊断，不能自动覆盖其他认证方式。

1. 从密码管理器取得正确环境配置，通过受保护的只读数据库查询核对账号 ID、邮箱和 admin 角色；查询只选择这些列，不导出 account/session 表。
2. 在仓库外创建 owner-only JSON 文件（Linux `0600`，Windows 限制 ACL），内容为 `{"password":"本人选择的新随机密码"}`。密码不放在命令行、shell 历史或环境转储中。
3. 明确配置 `PHOSKYWIKI_ENV=production` 和目标数据库环境。容器的 `runtime.json` 需增加 `"PHOSKYWIKI_ENV":"production"`，容器入口会读取该值。
4. 使用已有生产 Compose 配置及变量，额外挂载恢复文件到 ops；以下 ID/邮箱须替换成已核实的目标，主机路径须替换为实际受保护文件：

```sh
docker compose -f compose.production.yml run --rm --no-deps \
  -v /etc/phoskywiki/secrets/recovery.json:/run/secrets/recovery.json:ro \
  ops recover-admin --target postgres:5432/phoskywiki/phosky \
  --environment production --user-id VERIFIED_ID --email VERIFIED_EMAIL \
  --credentials /run/secrets/recovery.json
```

直接在已部署的应用目录运行时等价命令为：

```sh
pnpm ops:production recover-admin --target HOST:PORT/DATABASE/USER \
  --environment production --user-id VERIFIED_ID --email VERIFIED_EMAIL \
  --credentials /protected/path/recovery.json
```

命令不会加载 `.env`，必须显式提供运行环境。输出只含结果与目标环境，不输出密码/令牌/数据库连接串。退出码非零时先核对目标与受保护配置，不要运行 seed。成功后用新密码登录并验证原会话已失效，清理恢复文件及临时剪贴板，记录时间、操作者和目标账号（不记录秘密）。在密码管理器中更新恢复资料。

## 验证边界

HTTP 测试覆盖无邀请绕过、角色注入、用途隔离、过期/撤销/重放/并发、失败回滚、旧密码与旧会话。浏览器覆盖管理员签发/撤销、邀请注册、登录/刷新/登出、两名管理员受理后游客阅读、密码恢复及会话撤销。运维测试运行真实子进程验证错误目标保护和管理员恢复。夹具只存在于 `tests/`，调用前强制检查 `*_test` 数据库，注册夹具仍通过邀请兑换入口。

本地验收与真实 phoskywiki.org 上线分开：真实 HTTPS、Cloudflare/R2 和生产运维组合验收属于 D07，本文件不宣称这些已完成。

### 本次实现验证记录（2026-09-10）

- 审查基线 `8af127426a6f8ee78feefbb36fbf234059312e7b`，实现版本为本文件所在提交。Windows / Node 24.14.0 / Next.js 16.3.4；独立 PostgreSQL 18.4 数据库 `phoskywiki_test`、`d02_regression_test`，独立 Meilisearch 1.15.0 容器及 `pages-test` 索引。未连接生产数据库或对象存储。
- `pnpm typecheck`、`pnpm exec eslint src tests scripts next.config.ts`、`pnpm build` 成功。
- 本提交完整单元/集成套件（39 个文件）：278 通过，1 条真实 R2 契约缺少专用桶配置而未执行，包含 5 条真实 Meilisearch 契约。运行 `pnpm test --exclude tests/integration/backup-cli.test.ts`，仅排除了工作区并行备份任务新建、未包含在本提交的测试文件。
- 完整浏览器套件 `playwright test --workers=1`：83 通过，1 条需要专门旧库夹具的归并验收未启用。启用隔离 Meilisearch 并重建 `pages-test` 后，先前缺搜索服务的失败已消除；D02 邀请、双人受理及恢复闭环通过。
- 生产构建 `next start` 下的认证浏览器测试：3 通过，涵盖游客、邀请注册、登录、刷新会话、登出和错误密码。
- 规范/规格双轴审查发现的重复读取、并发旧密码登录和替代注册限流问题已修复，独立复查均无剩余发现。并发登录回归通过数据库夹具暂停真实会话插入，先复现失败，再验证修复；没有修改生产流程以便利测试。
