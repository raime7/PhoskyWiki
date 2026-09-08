# Spec #18 一期补齐与修复验收

关联：GitHub #18、#19–#29。评审基线：`855285b5be39d1dc8aafeef31a6c0a77d1e08905`。

功能基线：`3fee40105d7a72d708e0fc5602d6cf3e6558ea54`（全部 #19–#28 已整合）。首轮验收提交：`4385b54407b5502898ac9ac3edb809899f85de66`，仅在功能基线上增加 #29 的五条组合浏览器回归。后续 `09f0af2d9bb5f82f980a5135bceb0d8ca829773a` 修正旧审核测试，使过期重提明确确认已读取的最新修订。产品代码始终等同功能基线；首轮与复验的测试树差异在下文记录。本报告作为后续纯文档提交保存。

## 验证边界与隔离

主缝为已有 HTTP 端点、SSR 页面 DOM 和真实 Chrome 交互。数据库只用于迁移、隔离、夹具及清理；不通过私有表断言业务结果，不新增测试查询 API。解析、排序和快照纯函数只作补充。专用数据库为 `phosky_spec18_29`，浏览器服务端口 3129；本批未对生产或主开发库执行迁移、种子或校对。

## 八项发现与验收矩阵

下文测试路径均相对仓库根目录。

| 发现 | 工单 | 外部行为证据入口 |
| --- | --- | --- |
| Spec-1 图谱提示框 HTML 注入 | #19 | `tests/e2e/graph-tooltip.spec.ts` 在全站/局部真实画布悬停，检查标题与学派逐字文本、无注入 DOM/副作用/外部请求，点击导航；`graph.spec.ts` 保留缩放等交互 |
| Spec-2 词条元数据闭环 | #24、#25 | `tests/integration/term-edit.test.ts`、`term-history.test.ts`；`tests/e2e/term-edit.spec.ts`、`term-history.spec.ts`：三字段提案、草稿、两票、冷启动、直编、冲突、稳定 id、历史比较/回滚与旧历史兼容 |
| Spec-3 驳回重提 | #26 | `tests/integration/resubmission.test.ts`、`tests/e2e/resubmission.spec.ts`：五类完整预填、人工整理、失败草稿、权限与谱系；`spec18-combined.spec.ts`：系统驳回后恢复与 UI 重提 |
| Spec-4 视角可见性 | #21 | `tests/integration/visibility.test.ts`；`tests/e2e/visibility.spec.ts`：三个独立删除维度的入口、404、反链、热度、图谱、推荐与恢复 |
| Spec-5 父页面失效受理 | #22 | `tests/integration/perspective-parents.test.ts`：首票/末票、两种父页面、直编与并发；`tests/e2e/perspective-parents.spec.ts`：系统理由、通知和终态 |
| Spec-6 双链语义与存量 | #23、#28 | `tests/e2e/wiki-link-semantics.spec.ts` 的混合正文预览/发布/直编/回滚；`tests/e2e/reconcile-links.spec.ts`、`tests/integration/reconcile-links.test.ts` 的 CLI 报告、污染清除、旧目标身份、历史不变和锁失败重试 |
| Spec-7 游客三类兴趣 | #27 | `tests/integration/guest-discovery.test.ts`；`tests/e2e/interests.spec.ts`：学派、主题、组合、跨页/标签页、刷新、故障回退、账号等价与完整候选排序 |
| Standards-1 审核测试边界 | #20 | `tests/integration/review.test.ts`、`tests/e2e/review-behavior.spec.ts` 通过提交详情、历史 HTTP、阅读正文、反链和图谱验证；最终独立 code-review 另行记录 |

## 36 个用户故事

| 故事 | 可观察验收行为 | 正式验证入口 |
| --- | --- | --- |
| 1 | 全站和局部图谱的特殊字符按普通文本显示 | `e2e/graph-tooltip.spec.ts` |
| 2 | 提示框不创建注入 DOM、不产生脚本副作用、不发外部请求 | `e2e/graph-tooltip.spec.ts` |
| 3 | 悬停信息可读且节点点击到词条 | `e2e/graph-tooltip.spec.ts`、`e2e/graph.spec.ts` |
| 4 | 从词条页进入三字段元数据编辑 | `e2e/term-edit.spec.ts` |
| 5 | 编辑词条信息与编辑通俗视角入口分明 | `e2e/term-edit.spec.ts` |
| 6 | 草稿往返并提交完整元数据 | `e2e/term-edit.spec.ts`、`integration/term-edit.test.ts` |
| 7 | 审核前后逐字段比较 | `e2e/term-edit.spec.ts` |
| 8 | 普通编者元数据受理前不公开，两票后生效 | `integration/term-edit.test.ts`、`e2e/term-edit.spec.ts` |
| 9 | 管理员直接生效并有独立修订来源 | `integration/term-edit.test.ts`、`e2e/term-history.spec.ts` |
| 10 | 过期基准与撞名明确失败且不覆盖 | `integration/term-edit.test.ts`、`e2e/term-edit.spec.ts` |
| 11 | 改名后的旧 URL、普通/显式双链仍定位同一 id | `e2e/term-edit.spec.ts`、`e2e/wiki-link-semantics.spec.ts`；`e2e/reconcile-links.spec.ts` 改名后校对 |
| 12 | 任意两修订比较、带来源回滚、撞名原子失败 | `integration/term-history.test.ts`、`e2e/term-history.spec.ts` |
| 13 | 自己的驳回详情有修改后重提入口 | `e2e/resubmission.spec.ts`、`integration/resubmission.test.ts` |
| 14 | 重提草稿完整预填所有可编辑字段 | `e2e/resubmission.spec.ts`、`integration/resubmission.test.ts` |
| 15 | 过期基准同时呈现最新内容和原提案，人工确认整理 | `e2e/resubmission.spec.ts`、`integration/resubmission.test.ts` |
| 16 | 重提失败仍保留草稿 | `e2e/resubmission.spec.ts`、`integration/resubmission.test.ts` |
| 17 | 新提交关联原记录、原理由和投票不变 | `e2e/resubmission.spec.ts`、`integration/resubmission.test.ts`；`e2e/review-behavior.spec.ts` 补原终态 |
| 18 | 目标/父页面删除有解释且保留草稿 | `e2e/resubmission.spec.ts`、`integration/resubmission.test.ts`；`e2e/spec18-combined.spec.ts` 的两父页面恢复后 UI 重提 |
| 19 | 三页面都可见才提供显式视角入口 | `e2e/visibility.spec.ts` |
| 20 | 不可用显式视角不蓝链、不回退、不冒充写作缺口 | `e2e/visibility.spec.ts`、`e2e/wiki-link-semantics.spec.ts` |
| 21 | 删除词条/诠释者一致隐藏阅读、反链、热度、图谱、推荐和搜索 | `e2e/visibility.spec.ts`、`integration/visibility.test.ts` |
| 22 | 父页面恢复后恢复入口，独立删除的子视角仍隐藏 | `e2e/visibility.spec.ts` |
| 23 | 新视角最终受理再次验证父页面 | `integration/perspective-parents.test.ts` |
| 24 | 失效父页面生成终态系统理由与编者通知 | `integration/perspective-parents.test.ts`、`e2e/perspective-parents.spec.ts` |
| 25 | 删除与受理/直编并发结果可串行解释 | `integration/perspective-parents.test.ts` |
| 26 | 围栏、缩进、行内代码和转义不建立关系 | `e2e/wiki-link-semantics.spec.ts`，辅以 `unit/wiki-links.test.ts`、`unit/markdown.test.ts` |
| 27 | 真实渲染双链才贡献反链、热度、图谱和缺口 | `e2e/wiki-link-semantics.spec.ts` |
| 28 | 普通、别名、显式视角在真实预览/发布一致 | `e2e/wiki-link-semantics.spec.ts` |
| 29 | 校对清除历史假关系、保留改名目标 id 和修订，重复结果不变 | `e2e/reconcile-links.spec.ts`、`integration/reconcile-links.test.ts`；下文 CLI 两次演练 |
| 30 | 游客单选学派可重排其成员视角 | `integration/guest-discovery.test.ts`、`e2e/interests.spec.ts` |
| 31 | 三类兴趣都影响相关词条且组合不重复计分 | `integration/guest-discovery.test.ts`、`e2e/interests.spec.ts` |
| 32 | 主题只影响推荐，编委会/置顶优先级保留 | `integration/guest-discovery.test.ts`、`e2e/pin.spec.ts` |
| 33 | 同页变更、真实跨标签页事件和刷新保留兴趣 | `e2e/interests.spec.ts` |
| 34 | 有效兴趣一致时游客/账号完整排序与推荐相同 | `e2e/interests.spec.ts` |
| 35 | 无兴趣、损坏本地数据、失效对象、存储拒绝/请求失败可默认阅读 | `integration/guest-discovery.test.ts`、`e2e/interests.spec.ts` |
| 36 | 公开 HTTP/DOM 证明审核、修订与双链结果 | `integration/review.test.ts`、`e2e/review-behavior.spec.ts`；最终代码审查 |

上表 `e2e/`、`integration/`、`unit/` 均位于 `tests/` 之下。

## 四个原评审探针

| 修复前探针 | 正式回归 |
| --- | --- |
| 词条编辑被拒绝 | `tests/integration/term-edit.test.ts` 普通编者完整提案的两名管理员受理；`tests/e2e/term-edit.spec.ts` 完整表单草稿与公开生效 |
| 删除父页面仍显示有效显式链接 | `tests/e2e/visibility.spec.ts` term/interpreter 删除矩阵的不可用 span、无 href、404 与恢复 |
| 父页面删除后新视角仍受理 | `tests/integration/perspective-parents.test.ts` 两父页面首票/最终票与并发；`tests/e2e/perspective-parents.spec.ts` 编者可见系统驳回 |
| 代码示例生成虚假双链 | `tests/e2e/wiki-link-semantics.spec.ts` 混合正文的真实预览、发布、反链、热度和图谱 |

图谱安全另外由真实 Chrome 的 `graph-tooltip.spec.ts` 验证，不以静态扫描替代浏览器证据。

## 最终组合运行记录

2026-09-08，运行提交 `4385b54`，专用 PostgreSQL `phosky_spec18_29`：

| 命令 / 环境 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm build` | 默认 Next 16.3.4 Turbopack 生产构建通过（编译 7.6 秒）；本次无须 Webpack 回退 |
| `pnpm test`，`SEARCH_CONTRACT_HOST=http://localhost:7700` | 33 文件通过、1 文件跳过；250 测试通过、1 跳过，76.07 秒 |
| 真实 Meilisearch `pages-contract-test` 索引 | 全套 Vitest 内的 5 项契约通过，独立于并行功能实施时的主动跳过记录 |
| 真实 R2 契约 | 1 项环境跳过：缺少 `R2_CONTRACT_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY` 专用凭据；未执行且未计为通过 |
| 生产 Chrome 全 E2E，单 worker | 首轮 52 通过、23 失败，共 75 项；隔窗复跑及修正复验见下文 |
| `git diff --check` | 通过 |

Vitest 提示未来 Vite 原生配置加载器不支持当前 CommonJS 文件中的 ESM 语法；当前配置正常执行，未把该提示当作测试失败。

生产浏览器以 `pnpm start --port 3129` 启动上述构建，设置 `PW_PORT=3129`、`PW_CHANNEL=chrome` 后运行 `pnpm exec playwright test --workers=1`。首轮 4.3 分钟，连续注册/登录触发既有 better-auth 限流：失败页面显示 `Too many requests`，其余相关用例在未建立会话或未成功注册后的准备阶段失败。保留原日志和错误快照；未改认证配置或产品代码。随后每次间隔 11 秒，以 `pnpm exec playwright test <文件> --grep <原用例标题> --workers=1` 对 23 项逐项复跑，22 项通过。

剩余一项 `review-behavior.spec.ts` 在隔窗后显示真实的 HTTP 409：#20 的旧测试通过 helper 静默替换过期提案的 base，而 #26 要求针对最新修订明确确认。`09f0af2` 只改测试：先用公开历史响应核对最新版正文为“再次直编，不进入审核队列。”，再携带 `confirmedBaseRevisionId` 和 `supersedes` 创建新提交。该文件三项在 `09f0af2` 按同样 11 秒窗口逐项复验全部通过；类型检查及全仓 lint 已在该测试修正后再次通过。最终全部 75 条浏览器用例均有通过证据（首轮 52，22 条隔窗通过，余下 1 条修正通过；另外对修正文件完整三项复验）。构建、Vitest 及其他浏览器用例的产品代码未发生变化，未把不同测试树宣称为同一次全绿执行。

### 跨模块组合

- `tests/e2e/reconcile-links.spec.ts`：真实元数据改名 → 旧名被新词条复用 → 历史污染夹具 → CLI 校对两次 → 普通旧链到原改名词条、显式旧链到原视角；原历史不变，反链/热度/图谱/发现与实际正文一致。第二例验证锁超时和不存在页面的逐项失败、成功项继续、定点重试。
- `tests/e2e/spec18-combined.spec.ts`：词条/诠释者分别删除 → 新视角受理变系统驳回 → 详情进入重提并保存补充正文 → 父恢复 → 刷新保留草稿 → UI 创建关联的新提交 → 受理与公开阅读；旧记录及理由仍保持终态。
- `tests/e2e/term-history.spec.ts`：管理员元数据编辑与普通受理 → 非相邻修订字段比较 → 回滚生成新修订 → 页面字段、旧 id URL 与已解析双链可达 → 历史标题冲突明确失败。
- `tests/e2e/spec18-combined.spec.ts`：游客选择诠释者兴趣 → 相关词条出现且匿名接口匹配分为 1 → 分别删除视角、词条或诠释者 → 显式链接不可用、DOM 与匿名发现共同过滤 → 恢复后重新出现且保持原视角 href。

### 最终存量校对演练

2026-09-08 13:21（Asia/Shanghai），在全部浏览器活动结束后，对测试产生的实际内容集合执行以下命令两次，运行检出为 `09f0af2`（CLI 与固定功能基线相同）：

```powershell
pnpm --silent links:reconcile --database phosky_spec18_29 --all
```

| 字段 | 第一次 | 第二次 |
| --- | --- | --- |
| 目标 | localhost:5432 / phosky_spec18_29 | 相同 |
| selected / processed | 602 / 602 | 602 / 602 |
| failed / failures | 0 / 空列表 | 0 / 空列表 |
| unresolvedLinks | 7 | 7 |
| 退出码 | 0 | 0 |
| searchSync | disabled：未配置 MEILI_HOST | 相同 |

两份完整 JSON 文本逐字相同，stderr 为空。7 是此次成功校对的公开来源中真实剩余未解析引用数量，未将写作缺口当成校对失败。报告包含每个成功页面的修订 id、可见性与引用数量。专用环境的校对没有执行真实搜索同步；这与已经通过的真实 Meilisearch 端口契约是两个独立结果。

原始证据保存在主任务工作区 `.scratch/spec18-execution/`：`issue29-reconcile-first.json`、`issue29-reconcile-second.json`、`issue29-logs/`（首轮构建/静态检查/Vitest/浏览器日志、错误快照、23 项逐项复跑结果和修正文件三项复验结果）。历史污染清除与旧链接身份的正式外部行为证据见上面的 `reconcile-links.spec.ts`，本次全量重复演练补充实际操作与幂等性记录。

### 旧数据库升级演练

主任务于 2026-09-08 13:03（Asia/Shanghai）在专用 `phosky_spec18_legacyupgrade` 完成升级验证，运行实现为 `6e6306d`。用旧实现 `9bb9b5f` 迁移至 0012，准备一个真实旧词条及两条旧正文修订，再以新实现 `pnpm db:migrate` 应用 0013。通过既有 `GET /api/pages/90001/history` 验证：新增的 baseline 包含夹具预先指定的真实标题、简介和两个别名，两条旧正文原样保留且明确标记无结构化快照；总共三条修订。重复迁移和同一 HTTP 验证后仍恰好三条，没有重复 baseline。该演练作为升级证据；正式旧历史兼容回归仍在 `term-edit` 与 `term-history` 测试中。

## 目标环境操作

精确参数和故障处理见 [存量双链校对操作说明](reconcile-links.md)。在目标环境的应用检出中先核对已部署代码、迁移版本及 `DATABASE_URL` 的主机、端口、库名和 `MEILI_HOST`。不要在报告或命令参数中记录密码。使用目标的实际库名代替以下独立验收库示例：

```powershell
pnpm --silent links:reconcile --database phosky_spec18_29 --all 1> reconcile-first.json 2> reconcile-first-errors.log
pnpm --silent links:reconcile --database phosky_spec18_29 --all 1> reconcile-second.json 2> reconcile-second-errors.log
```

每次检查退出码、JSON 的 `target`、`selected/processed/failed/failures` 和 stderr。无并发内容变化时两次报告应一致；有失败则依据 `pageId` 使用 `--page-id` 定点重试，成功页已提交无需撤回。校对只修改派生双链，不用种子清库替代校对。`--database` 仅校验库名，跨主机同名库仍需运维核对。

搜索同步字段 `requested` 只证明请求过同步；检查 stderr 后按需在同一环境运行 `pnpm search:reindex`。未配置 `MEILI_HOST` 会明确报告 `disabled`。图谱沿用 60 秒新鲜期及 300 秒 stale-while-revalidate 缓存，验收应请求源站或等待缓存失效。生产迁移、校对和部署均未在本任务执行。

## 审查交接

#29 的组合回归与验收证据已完成，唯一未执行的服务契约为缺少凭据的真实 R2。按本次任务分工，主任务在接收此提交后统一进行 Standards / Spec 双轴 code-review；本报告不提前宣称该独立审查通过。不自动关闭父 Spec 或功能工单，也未推送或发布。
