# 书籍流水线（#105）

把诠释者著作的中译本整理成视角的本地离线流水线。领域规则见 `CONTEXT.md` 和 ADR-0009。所有命令都作用于同一个**工作目录**：每个命令读写确定的文件，可以单独重跑。

完整顺序（「会话」是 Claude Code 会话的判断环节，其余是命令）：freeze → export-site → 会话写候选 → candidates → confirm → 会话写文风档案 → 会话写论点映射 → 润色子代理 → assemble / incremental → validate → 审稿子代理 → submit。会话环节的做法见技能 `.claude/skills/source-to-concepts/`。各产物的类型定义在 `types.ts`，路径定义在 `workdir.ts`，命令都经它取路径。运行错误一律用 `errors.ts` 的 `fail(code, message)` 抛出。

```bash
pnpm book-pipeline freeze <file> --toc                  # 先列出标题与节号，用来选择范围
pnpm book-pipeline freeze <file> --workdir <dir> --id <sourceId> \
  --title 小逻辑 --author 黑格尔 --translator 贺麟 --edition "商务印书馆，1980" \
  --from "A．质" --to "§ 98"
pnpm book-pipeline rules                                # 打印默认冻结规则，可另存一份后用 --rules 覆盖
pnpm test:pipeline                                      # node --test scripts/book-pipeline/*.test.mjs
```

工作目录含原书全文，受版权保护，只能放在本地，不要放进仓库。

## 工作目录布局

一个工作目录只服务一位诠释者，即著作的著者（ADR-0007）。同一诠释者的多本书可以冻结到同一个目录，供增量并入使用。

| 路径 | 产物（`types.ts` 中的类型） | 写入者 |
| --- | --- | --- |
| `workdir.json` | `WorkdirManifest`：诠释者，以及已冻结的来源列表 | freeze |
| `sources/<id>/original.<ext>` | 原文件的逐字节副本 | freeze |
| `sources/<id>/manifest.json` | `SourceManifest`：文件与成员哈希、著作、译本、范围、生效规则、计数、其余产物的哈希 | freeze |
| `sources/<id>/paragraphs.jsonl` | `FrozenParagraph`，每行一段，句子内嵌；包括被范围内注号引用、本身在范围外的注释段落（`inRange: false`） | freeze |
| `sources/<id>/landmarks.json` | `Landmark[]`：全书的标题与节号 | freeze |
| `sources/<id>/normalization-log.jsonl` | `NormalizationLogEntry`：每段做了哪些规范化，以及规范化前后的文字 | freeze |
| `sources/<id>/reading.md` | 供会话阅读的稿子，标出段落 ID 和 ⟨n⟩ 句号；不是发表格式 | freeze |
| `candidates/session-candidates.json` | `SessionCandidates`：会话产出的候选与去重结果（新词条含 `termSummary`） | 会话 |
| `candidates/site-terms.json` | `SiteExport`：站上在线的词条、别名、诠释者和视角 | export-site |
| `candidates/candidates.json` | `CandidateList`：供站长确认的候选清单，含被排除的候选及原因 | candidates（#108） |
| `candidates/confirmation.json` | `CandidateConfirmation`：绑定清单哈希；清单一旦重新生成，确认即失效 | confirm（#108） |
| `style/profile.md` | 文风档案（Markdown，小节见 `STYLE_PROFILE_SECTIONS`）：术语与译名、论证次序、推理与转折、仿写风险；增量运行沿用 | 会话 |
| `perspectives/<key>/claim-map.json` | `ClaimMap`：一句话核心，以及各论点的解读和摘录引用；润色后由润色子代理改写 | 会话，润色子代理 |
| `perspectives/<key>/claim-map.pre-polish.json` | 润色前的 `ClaimMap` 副本，供比对润色只改了文字 | 润色子代理 |
| `perspectives/<key>/perspective.md` | 组装好的视角 Markdown | assemble（#109） |
| `perspectives/<key>/assembled.json` | `AssembledPerspective`：回填的引文、覆盖范围和输入哈希 | assemble（#109） |
| `perspectives/<key>/review.json` | `ReviewReport`：审稿子代理的报告，绑定 perspective.md 的哈希 | 会话子代理 |
| `perspectives/<key>/overrides.json` | `LimitOverride[]`：人工放行的超限项 | 站长 |
| `perspectives/<key>/validation.json` | `ValidationReport` | validate（#110） |
| `perspectives/<key>/base.json` | `IncrementalBase`：现有视角的 head 修订和最近一次 AI 修订 | export-site --key，或 incremental --head |
| `perspectives/<key>/locks.json` | `LockInfo`：人工改过而锁定的块 | incremental（#111） |
| `submit/plan.json` | `SubmitPlan`：试运行时列出的提交请求 | submit（#112） |
| `submit/ledger.jsonl` | `LedgerEntry`：写入账本，只追加 | submit（#112） |

## 约定

- **ID**：段落 ID 的格式是 `<sourceId>:<unit>.p<n>`，句子 ID 的格式是 `<段落 ID>.s<n>`。EPUB 的 unit 是书脊序号 `dNN`，不在书脊中的文档是 `mNN`；TXT 和 MD 的 unit 都是 `t`。n 按该单元内的全部段落计数，所以改变章节范围或重跑都不会改变已有 ID。
- **摘录引用**：`ExcerptRef` 由段落 ID 和起止句号组成，句号从 1 起，闭区间。模型从不书写引文文字。
- **偏移**：强调、句子和注号的偏移都是规范化后 `text` 上的 JS 字符串下标，区间半开。
- **确定性**：freeze 的产物不含时间戳和调用路径，重跑逐字节一致。对已有来源，内容不同的重跑会被拒绝（`FROZEN_SOURCE_CHANGED`），除非加 `--force`。`verifyFrozenSource()` 用保存的原文件重新冻结，以此检查产物是否被改动。
- **层次**：段首标记切换层次（〔说明〕、附释一：……），并延续到下一个标题或节号；〔译注〕等标记只作用于本段。EPUB 的注释段落按链接目标配对，不按显示的数字配对，再按文字判定是译注、原注还是编者注。
- **规范化**：只去掉段首尾空白和不可见字符，合并空白，并把中文之间的排版换行直接接上（不插空格）。不做 Unicode 归一化，不改字形和标点。每一项都记入日志。
- **不支持 OCR**：只接受有文字层的 EPUB、UTF-8 编码的 TXT 和 Markdown。
- **退出码**：0 表示成功；1 表示运行错误，错误信息以 `CODE: …` 开头；2 表示用法错误。

## 站点导出（export-site）

```bash
pnpm book-pipeline export-site --workdir <dir> --origin <url>                                  # → candidates/site-terms.json
pnpm book-pipeline export-site --workdir <dir> --origin <url> --key <key> ... --ai-user <用户 id>  # → perspectives/<key>/base.json
```

- 只读：只 GET 站点接口，不写站点；唯一的副作用是登录。设了 `BOOK_PIPELINE_EMAIL` / `BOOK_PIPELINE_PASSWORD`（与 submit 同一账号，登录逻辑在 `site-session.ts`）时先登录，否则以游客身份读取。`--key` 的历史接口始终以游客身份读取。HTTP 只是 `export-site.ts` 底部的薄层；载荷整理是纯函数（`siteExportFromCatalog`、`incrementalBaseFromHistory`），测试用夹具覆盖。
- `site-terms.json` 取自 `GET /api/site-catalog`（`src/lib/site-catalog.ts`）：在线的词条（含别名）、诠释者、视角（`headRevisionId` = 该页最大修订 id）。软删除的页面不在其中，`deleted` 一律为 false。每次运行都重写（含 `exportedAt`）。
- `deletedTermTitles`：已软删除词条的标题（站点的词条标题唯一索引 `pages_term_title_unique` 也覆盖它们，同名新建会被拒绝）。只有编者以上登录时接口才返回（只有标题，没有 id 和正文）；游客导出时为 null，并打印 `WARN`，说明已删除词条的同名检查被跳过。
- `--key` 按候选清单里的 `existingPerspective` 取 `GET /api/pages/<pageId>/history`：head = 最大修订 id；上一次 AI 修订 = `createdBy` 等于 `--ai-user` 的最大修订 id，没有则为 null。全部键取到后才落盘；输出行的 `headMovedSinceCandidates` 表示 head 在生成候选清单之后又有了新修订（incremental 与 submit 以 base.json 为准）。
- 错误码：`EXPORT_SITE_ORIGIN`、`EXPORT_SITE_HTTP`、`EXPORT_SITE_PAYLOAD`、`EXPORT_SITE_AI_USER`、`EXPORT_SITE_UNKNOWN_KEY`、`EXPORT_SITE_NO_PERSPECTIVE`、`MISSING_INPUT`。

## 候选与确认（#108）

```bash
pnpm book-pipeline candidates --workdir <dir>      # 读 candidates/session-candidates.json + site-terms.json，写 candidates.json
pnpm book-pipeline confirm --workdir <dir> --by <站长名> (--all | --keys a,b)
```

- 新词条（未命中站上词条）的规范名若与 `deletedTermTitles` 中的标题相同，候选不进 `entries` 而进 `blocked`，原因「与已删除词条同名：先在站上恢复该词条，再重新 export-site 与 candidates」；`confirm` 拒绝它（`NOT_CONFIRMABLE`）。`submit` 对 `new_term` 再做一次同样的防御检查（`SUBMIT_DELETED_TERM`）。
- 站点词条按规范名与别名（NFKC、去空白和间隔点、不分大小写）对标题与别名匹配，标题优先；已删除的词条不参与。一个候选命中多个词条（`AMBIGUOUS_TERM`）、两个候选命中同一词条或名称重叠（`DUPLICATE_CONCEPT`）都是错误，应回会话合并（相同）或改成 `related`（相关）。
- 准入：`treatment=dedicated` 且（有效论点至少 2 个，或 `centralParagraphs` 至少 1 段）；其余进入 `excluded` 并写明原因。引用的段落必须是已冻结的范围内段落。
- 词条简介：准入且未命中站上词条的候选（将新建词条）须有 `termSummary`——一句中性的词条说明，单行非空，否则 `TERM_SUMMARY_MISSING`。它进入清单条目，submit 用作 `new_term` 的 `summary`；诠释者的理解属于视角的一句话核心，两者不混用。命中已有词条时清单里为 null。
- `confirm` 只接受 `entries` 中的键；清单与输入不一致时拒绝（`STALE_LIST`）。确认绑定 `candidates.json` 的 sha256，之后任何改动清单的重新生成都使确认失效。
- 闸门：后续命令调用 `candidates.ts` 的 `requireConfirmed(workdir, key?)`，未确认、已失效或键不在确认之列时抛出 `UNCONFIRMED: …`。

## 文风档案与润色（会话环节，ADR-0009）

没有对应命令，产物契约如下；做法见技能的 `references/style-profile.md` 与 `references/polish-prompt.md`。

- `style/profile.md`：确认之后、写论点映射之前，会话从冻结来源整理一次（一个工作目录只有一位诠释者，所以只有一份），按 `types.ts` 的 `STYLE_PROFILE_SECTIONS` 分节。写解读借用其中的术语、译名和论证次序，句子保持现代中文。增量运行沿用，新书带来新术语时追加。
- 润色：论点映射写完后、assemble / incremental 之前，子代理先把 `claim-map.json` 存为 `claim-map.pre-polish.json`，再只改写 `core` 与各论点的 `exposition`；`id`、`heading`、`revision`、`excerpts` 和双链目标原样不动。增量论点映射的 `core` 必须照抄 head，所以增量时只改 `extended` / `new` 论点的 `exposition`。

## 组装（#109）

```bash
pnpm book-pipeline assemble --workdir <dir> [--key <key> ...] [--rewrite <key> ...]   # 缺省 = 全部已确认且已有 claim-map.json 的新视角
```

- 先过 `requireConfirmed` 闸门；全部概念在内存中组装并自检通过后才落盘，任何一个失败都不写文件。重跑逐字节一致。
- 模板结构、引文 Markdown 的写法与解析器都在 `template.ts`（`TEMPLATE`、`parsePerspectiveMarkdown`、`renderedExcerpts`），validate 与 incremental 复用，不要另写一套。
- 摘录只能引用范围内段落（`inRange`），引用对象只许 `{ paragraph, from, to }` 三个字段；引文 ASCII 标点全部转义，强调两侧加 `<!-- -->`，自检用站点渲染管线核对可见文字与强调。
- 论点映射的共用规则（schema、身份、论点 ID、`revision`、解读块类型、摘录引用字段）在 `claim-map.ts`，与 incremental 共用；assemble 另要求核心是一个段落、每个论点有标题和解读。
- 已有视角（候选清单的 `existingPerspective`）归 incremental：缺省跳过并输出 `{status: "skipped"}` 行，`--key` 点名则拒绝（`ASSEMBLE_EXISTING_PERSPECTIVE`）。`--rewrite <key>`（同时选中该键）才整篇重写为 `mode: "edit"`，`baseRevisionId` 取 `base.json` 的 head（与 submit 同一取法），没有 base.json 时取清单的 `headRevisionId`；用于 head 不合模板、无法增量的视角（如试点时期的《小逻辑》A．质），会覆盖已受理的措辞，须经站长同意。对新视角用 `--rewrite` 报 `ASSEMBLE_REWRITE_NEW`。
- 错误码：`UNCONFIRMED`、`MISSING_INPUT`、`ASSEMBLE_CLAIM_MAP`、`ASSEMBLE_EXCERPT`、`ASSEMBLE_PSEUDO_INTERPRETER`、`ASSEMBLE_SOURCE_TAMPERED`、`ASSEMBLE_SELF_CHECK`、`ASSEMBLE_EXISTING_PERSPECTIVE`、`ASSEMBLE_REWRITE_NEW`、`ASSEMBLE_NOTHING`。

## 校验（#110）

```bash
pnpm book-pipeline validate --workdir <dir> [--key <key> ...]   # 缺省 = 全部已确认且已组装的概念
```

- 先过确认闸门；每个概念写 `perspectives/<key>/validation.json`（`ValidationReport`，`validation@2`，不含时间戳，重跑逐字节一致）。有未放行的发现项时仍写报告，然后以退出码 1 结束（`VALIDATION_FAILED: <keys>`）。显式 `--key` 且清单未确认时，不中止，而是报告 `unconfirmed` 发现项。
- `findings[].severity`：`limit` = 硬上限，可放行；`error` = 不可放行。`ok` 为真当且仅当放行后没有剩余发现项。`hints`（`validation@2` 新增）是不阻断的提示，不进 `findings`、不影响 `ok`、不能也不必放行；命令输出行的 `hints` 是条数。被放行的项不在 `findings` 里，而在 `overridden`（原样回显 `LimitOverride`）里列出。`claimId` 对应 `claim-map.json` 的论点 ID（没有论点映射时为 `claim-<序号>`），与整篇有关的项为 null。
- 硬上限（`validate.ts` 的 `LIMITS`，按不含空白的字符数计）：论点 ≤ 5；每论点摘录 ≤ 3；单段摘录的可见引文 ≤ 200 字（不含“……”）；一句话核心加全部论点解读的可见文字 ≤ 1500 字（`limit.exposition-length`，整篇一项，`claimId` 为 null）。
- 放行：`perspectives/<key>/overrides.json` 是 `LimitOverride[]`。只接受 `limit.*` 规则；`rule` 与 `claimId` 须与发现项完全一致（整篇项用 null）；`reason`、`approvedBy` 必填。格式不对即 `OVERRIDES_INVALID`，不静默忽略。
- 双链：用站点的 `wiki-links.ts` 解析、`markdown.ts` 渲染。目标须是 `site-terms.json` 中未删除的词条（含别名）或本批已确认候选（规范名与别名）。`[[词条|视角@诠释者]]` 的诠释者须是站上诠释者或本工作目录的诠释者，且该视角存在于站上（或属于本批）。`wikilink.reserved-at`：词条名含 `@`、`@` 前无显示文字、`@` 后无诠释者、显示文字中含第二个 `@`。
- 引文逐字回查：`assembled.json` 的 `markdownSha256` 与当前稿一致时，按其记录的摘录引用从冻结段落重新取引文，与站点渲染出的可见文字、强调和出处逐项比对。稿子被改过（哈希不一致）时退化为：引文须是某个范围内冻结段落的逐字子串，出处须与该段落相符。
- 资料覆盖范围：由实际引用推导（与 assemble 同一套文案），「资料覆盖范围」「译本」两个列表须与之完全一致；缺项、多项、文字不同都报 `coverage`。
- 照录原文（`exposition.verbatim-source`，error）：一句话核心与各论点解读（引用块之外的段落和列表，止于分隔线）按站点渲染的可见文字（双链取显示文字）、去掉全部空白后，与某一个冻结段落（含范围外注释段落）去掉全部空白后的文字有连续 ≥ 20 个码点（`VERBATIM_RUN_CHARS`，标点计入）相同即报，给出整段相同片段的长度和段落 ID。只在单个段落内比较。短于 20 字的引语、术语照常允许；要引更长的原文就改为摘录。`perspectives/<key>/base.json` 存在时，与其 head 逐字相同的块（已发表，增量也不许改动）不检查。
- 文风提示（`style.ai-pattern`，hint）：同样范围的可见文字按论点合并（一句话核心 `claimId` 为 null），对 `style-patterns.ts` 的中文 AI 腔清单计数，达到各模式的阈值即提示。清单只收正则认得准的套话与句式，这是唯一的一份；判断性的模式由润色子代理处理（技能的 `references/humanizer.md`）。与 base.json head 相同的块同样跳过。
- 伪诠释者：工作目录、论点映射、assembled.json 的诠释者名、来源著者、双链里的诠释者名，命中 `isPseudoInterpreter` 即报。
- 锁定段落：`locks.json`（`LockInfo`，#111 产生；不存在即无锁定）。每个锁定块的 `text` 必须仍作为稿子的某个顶层块逐字存在（位置可以移动）；块的切法与哈希见 `blocks.ts` 的 `topLevelBlocks`，#111 生成锁定信息时须用同一函数。`LockInfo.headRevisionId` 须等于 `assembled.json` 的 `baseRevisionId`（若有）。
- 错误码：`UNCONFIRMED`（缺省全部概念时）、`MISSING_INPUT`、`OVERRIDES_INVALID`、`VALIDATE_NOTHING`、`ASSEMBLE_SOURCE_TAMPERED`。

### 审稿报告的落盘位置

审稿由会话中全新上下文的子代理执行，不由本命令执行。提交器只接受 `validation@2` 的报告（旧报告报 `VALIDATION_STALE`，重跑 validate 即可），门禁只看 `findings` 与放行，`hints` 不阻断，但以「【文风提示】」一节列入提交说明。报告写到 `perspectives/<key>/review.json`（`ReviewReport`），其 `perspectiveSha256` 必须是被审阅的 `perspective.md` 的 sha256。稿子重新组装或被改动后，报告即过期，须重审。`validate` 在每个概念的输出行里给出 `review: {status: missing|stale|current, blockers}`，但不把审稿结果计入 `ok`；提交器（#112）应把当前的审稿报告与 `validation.json` 摘要一并写入提交说明，并拒绝过期的报告。

## 增量更新（#111）

```bash
# 1. 导入现有视角：export-site --key 写好的 base.json（或用 --head 等参数直接导入 Markdown 导出）→ locks.json，并输出增量论点映射的骨架
pnpm book-pipeline export-site --workdir <dir> --origin <url> --key <key> --ai-user <用户 id>
pnpm book-pipeline incremental --workdir <dir> --key <key>
#   或：incremental --workdir <dir> --key <key> --head head.md --head-revision <id> (--last-ai ai.md --last-ai-revision <id> | --no-last-ai) [--page <id>]
# 2. 会话按骨架写 perspectives/<key>/claim-map.json（增量形式），再并稿（省略 --head 即沿用 base.json）
pnpm book-pipeline incremental --workdir <dir> --key <key>
pnpm book-pipeline validate --workdir <dir> --key <key>
```

- 只用于候选清单里已有视角（`existingPerspective`）的概念，并先过确认闸门；`--page` 缺省取该视角，给出时须一致。head 必须符合模板（否则经站长同意用 `assemble --rewrite <key>` 整篇重写）；从无 AI 修订时用 `--no-last-ai`。
- **锁定**：用 `blocks.ts` 的 `topLevelBlocks` 切 head；分隔线之前的正文块，若不以同样文字出现在上一次 AI 修订中，即人工改过，写入 `locks.json`（没有 AI 修订时正文全部锁定）。分隔线之后的资料说明由程序依引用推导，不锁；若其中有块不见于上一次 AI 修订（人工改过），命令拒绝（`INCREMENTAL_FOOTER_EDITED`），什么都不写。站长同意按引用重新推导、放弃这些改动时，每次运行都加 `--rederive-footer`（stderr 给出 `NOTE`，输出行的 `footerHumanEdits` 为被覆盖的块数）。
- **增量论点映射**：仍是 `ClaimMap`（`claim-map@1`），共用检查见 `claim-map.ts`（与 assemble 相同），其上叠加增量规则：`core` 须逐字照抄 head；head 的每个论点按原顺序、以原标题出现一次：`kept` 不加任何东西，`extended` 的 `exposition` 只写追加的解读、`excerpts` 只列追加的摘录；`revision: "new"` 是新论点，可插在任意位置，标题不得与既有论点相同。不能删除、改写或调换既有论点。
- **并稿**：正文以 head 原文为底，只插入，既有字节一个不改：追加的解读接在该论点原解读之后，追加的摘录接在原摘录之后，新论点整节插在前一个论点之后。新摘录与 assemble 一样依引用回填，出处行以《书名》标注所出书目；资料覆盖范围与译本按全部引用重新推导（与 assemble 同一套文案与顺序）。
- **既有摘录**须能在本工作目录的冻结来源中逐字定位（出处行一致、某个句子范围回填出相同的可见文字），所以旧书也要冻结在同一目录；定位结果写入 `assembled.json`，validate 因而走精确回查。
- 产物：`base.json`、`locks.json`，以及 `perspective.md` + `assembled.json`（`mode: "edit"`，`baseRevisionId` = head）。全部在内存中算好并自检（模板、站点渲染、既有正文块原样且顺序不变）后才落盘；重跑逐字节一致。submit 以 `base.json` 的 head 为 base，稿子的 `baseRevisionId` 与之不同即拒绝（`SUBMIT_STALE`）。
- 错误码：`UNCONFIRMED`、`MISSING_INPUT`、`INCREMENTAL_NO_PERSPECTIVE`、`INCREMENTAL_PAGE_MISMATCH`、`INCREMENTAL_BASE_INVALID`、`INCREMENTAL_HEAD_TEMPLATE`、`INCREMENTAL_FOOTER_EDITED`、`INCREMENTAL_EXCERPT_UNRESOLVED`、`INCREMENTAL_CLAIM_MAP`、`INCREMENTAL_SELF_CHECK`、`ASSEMBLE_EXCERPT`、`ASSEMBLE_PSEUDO_INTERPRETER`、`ASSEMBLE_SOURCE_TAMPERED`。
