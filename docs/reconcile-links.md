# 存量双链校对（R10 / #28）

在持有目标 PostgreSQL 运维凭据的应用检出目录执行。命令只校对当前正文的派生关系，不更新正文、页面时间、修订、提交、图片或删除标记。禁止用 `db:seed`、TRUNCATE 或清空内容库代替校对；种子命令仅供独立测试库。

先核对当前目录、`.env`（或已导出的环境变量）的 `DATABASE_URL` 主机、端口、数据库名，以及 `MEILI_HOST` 对应同一环境。shell 已导出的变量优先于 `.env`。`--database` 必须与连接串和实际连接的数据库名相同；它防止误用数据库名，不能区分两个主机上的同名数据库。不要把连接密码写进命令行或报告。

```powershell
# 示例专用于独立验收库 phosky_spec18_28；生产操作须使用生产检出与实际库名。
pnpm links:reconcile --database phosky_spec18_28 --all

# 定点校对 / 按失败列表重试，可重复指定页面 id。
pnpm links:reconcile --database phosky_spec18_28 --page-id 457 --page-id 463

# 机器可读 JSON 留档（pnpm --silent 去掉命令横幅）。另存 stderr 的同步告警。
pnpm --silent links:reconcile --database phosky_spec18_28 --all 1> reconcile.json 2> reconcile-errors.log
```

需要当前代码与数据库迁移已部署。`--all` 在开始时选取全部页面 id（含软删除页），顺序逐页事务处理；运行期间新建页面由正常保存管线处理，下一次全量校对也会包含它们。每页先获取与受理、直编、回滚共用的页面锁，再读取最新修订，避免覆盖并发保存的关系。锁等待超过 5 秒或单条 SQL 超过 60 秒报告失败，其他页面继续；该页事务回滚，修复故障后使用 `--page-id` 重试，或重新运行 `--all`。运行被中断时，已完成页面已提交，安全地重跑全量即可。

正文复用渲染器的 Markdown AST：围栏、缩进、行内代码与转义示例不会形成关系。仍存在的已解析名称键保留原目标 id，包含改名、旧名被另一词条复用及目标暂时隐藏的情况。真正未解析的红链可在目标创建后解析。词条信息框不作为 Markdown 正文，其历史纯文本也不用于重建关系。没有修订的页面按空正文处理。

标准输出是一份 JSON：`selected` 是选中页数，`processed` 是成功页数，`failed` 与 `failures` 逐项给出失败 `pageId`、数据库错误码和原因。`pages` 给出成功页的当前 `revisionId`、可见性、去重后的 `references`、实际剩余 `unresolvedLinks`。顶层 `unresolvedLinks` 只汇总本次成功校对且公开可见的来源页，是该范围的写作缺口引用数（同名缺口在不同来源页分别计数）；有失败时不能当作全库总数。无内容/可见性变动时，重复执行报告稳定。非零退出码表示校对失败或参数错误，成功页不会被其他失败页回滚。

反链、视角引用热度、相关词条推荐与图谱都直接从当前关系读取；没有另一份聚合数据需要重灌。正文页面和发现接口按现有读取机制更新；图谱 HTTP 响应继续使用现有 `max-age=60, stale-while-revalidate=300`，浏览器/CDN 旧图谱可能在该期限内显示旧值，可在验收时重新请求源站或等缓存过期。

每个成功事务沿用 `queueSearchSync` / `transactionWithSearchSync` 提交后同步，并沿用词条、诠释者的依赖扩展。搜索失败按现有机制写到 stderr，不回滚已完成关系校对；JSON 的 `searchSync` 只表示已请求同步，**不宣称索引成功**。查看 stderr，排除搜索故障后在同一环境运行 `pnpm search:reindex`；此命令只重建派生索引。未配置 `MEILI_HOST` 时 JSON 明确报告 disabled。

自动验收：`pnpm test tests/integration/reconcile-links.test.ts` 验证 CLI 范围、目标保护及全量重复报告；`pnpm test:e2e tests/e2e/reconcile-links.spec.ts --workers=1` 用独立数据库、种子管理员和真实 HTTP 改名，验证污染清除、旧名目标身份、历史不变、反链、热度、图谱、发现、正文红链，以及锁失败后的定点重试。
