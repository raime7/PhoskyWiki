# 书籍流水线（#105）

把诠释者著作的中译本整理成视角的本地离线流水线。领域规则见 `CONTEXT.md` 和 ADR-0009。所有命令都作用于同一个**工作目录**：每个命令读写确定的文件，可以单独重跑。各产物的类型定义在 `types.ts`，路径定义在 `workdir.ts`，命令不要自己拼接文件名。

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
| `candidates/session-candidates.json` | `SessionCandidates`：会话产出的候选与去重结果 | 会话 |
| `candidates/site-terms.json` | `SiteExport`：站上已有的词条、别名、诠释者和视角 | 导出 |
| `candidates/candidates.json` | `CandidateList`：供站长确认的候选清单，含被排除的候选及原因 | candidates（#108） |
| `candidates/confirmation.json` | `CandidateConfirmation`：绑定清单哈希；清单一旦重新生成，确认即失效 | confirm（#108） |
| `perspectives/<key>/claim-map.json` | `ClaimMap`：一句话核心，以及各论点的解读和摘录引用 | 会话 |
| `perspectives/<key>/perspective.md` | 组装好的视角 Markdown | assemble（#109） |
| `perspectives/<key>/assembled.json` | `AssembledPerspective`：回填的引文、覆盖范围和输入哈希 | assemble（#109） |
| `perspectives/<key>/review.json` | `ReviewReport`：审稿子代理的报告，绑定 perspective.md 的哈希 | 会话子代理 |
| `perspectives/<key>/overrides.json` | `LimitOverride[]`：人工放行的超限项 | 站长 |
| `perspectives/<key>/validation.json` | `ValidationReport` | validate（#110） |
| `perspectives/<key>/base.json` | `IncrementalBase`：现有视角的 head 修订和最近一次 AI 修订 | 导出（#111） |
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
- **退出码**：0 表示成功；1 表示运行错误，错误信息以 `CODE: …` 开头；2 表示用法错误或命令尚未实现。

## 候选与确认（#108）

```bash
pnpm book-pipeline candidates --workdir <dir>      # 读 candidates/session-candidates.json + site-terms.json，写 candidates.json
pnpm book-pipeline confirm --workdir <dir> --by <站长名> (--all | --keys a,b)
```

- 站点词条按规范名与别名（NFKC、去空白和间隔点、不分大小写）对标题与别名匹配，标题优先；已删除的词条不参与。一个候选命中多个词条（`AMBIGUOUS_TERM`）、两个候选命中同一词条或名称重叠（`DUPLICATE_CONCEPT`）都是错误，应回会话合并（相同）或改成 `related`（相关）。
- 准入：`treatment=dedicated` 且（有效论点至少 2 个，或 `centralParagraphs` 至少 1 段）；其余进入 `excluded` 并写明原因。引用的段落必须是已冻结的范围内段落。
- `confirm` 只接受 `entries` 中的键；清单与输入不一致时拒绝（`STALE_LIST`）。确认绑定 `candidates.json` 的 sha256，之后任何改动清单的重新生成都使确认失效。
- 闸门：后续命令调用 `candidates.ts` 的 `requireConfirmed(workdir, key?)`，未确认、已失效或键不在确认之列时抛出 `UNCONFIRMED: …`。

## 组装（#109）

```bash
pnpm book-pipeline assemble --workdir <dir> [--key <key> ...]   # 缺省 = 全部已确认且已有 claim-map.json 的概念
```

- 先过 `requireConfirmed` 闸门；全部概念在内存中组装并自检通过后才落盘，任何一个失败都不写文件。重跑逐字节一致。
- 模板结构、引文 Markdown 的写法与解析器都在 `template.ts`（`TEMPLATE`、`parsePerspectiveMarkdown`、`renderedExcerpts`），validate 与 incremental 复用，不要另写一套。
- 摘录只能引用范围内段落（`inRange`），引用对象只许 `{ paragraph, from, to }` 三个字段；引文 ASCII 标点全部转义，强调两侧加 `<!-- -->`，自检用站点渲染管线核对可见文字与强调。
- `mode` 由候选清单的 `existingPerspective` 决定：已有视角即 `edit`，`baseRevisionId` 取其 `headRevisionId`。
- 错误码：`UNCONFIRMED`、`MISSING_INPUT`、`ASSEMBLE_CLAIM_MAP`、`ASSEMBLE_EXCERPT`、`ASSEMBLE_PSEUDO_INTERPRETER`、`ASSEMBLE_SOURCE_TAMPERED`、`ASSEMBLE_SELF_CHECK`、`ASSEMBLE_NOTHING`。

## 校验（#110）

```bash
pnpm book-pipeline validate --workdir <dir> [--key <key> ...]   # 缺省 = 全部已确认且已组装的概念
```

- 先过确认闸门；每个概念写 `perspectives/<key>/validation.json`（`ValidationReport`，不含时间戳，重跑逐字节一致）。有未放行的发现项时仍写报告，然后以退出码 1 结束（`VALIDATION_FAILED: <keys>`）。显式 `--key` 且清单未确认时，不中止，而是报告 `unconfirmed` 发现项。
- `findings[].severity`：`limit` = 硬上限，可放行；`error` = 不可放行。`ok` 为真当且仅当放行后没有剩余发现项。被放行的项不在 `findings` 里，而在 `overridden`（原样回显 `LimitOverride`）里列出。`claimId` 对应 `claim-map.json` 的论点 ID（没有论点映射时为 `claim-<序号>`），与整篇有关的项为 null。
- 硬上限（`validate.ts` 的 `LIMITS`，按不含空白的字符数计）：论点 ≤ 5；每论点摘录 ≤ 3；单段摘录的可见引文 ≤ 200 字（不含“……”）；一句话核心加全部论点解读的可见文字 ≤ 1500 字（`limit.exposition-length`，整篇一项，`claimId` 为 null）。
- 放行：`perspectives/<key>/overrides.json` 是 `LimitOverride[]`。只接受 `limit.*` 规则；`rule` 与 `claimId` 须与发现项完全一致（整篇项用 null）；`reason`、`approvedBy` 必填。格式不对即 `OVERRIDES_INVALID`，不静默忽略。
- 双链：用站点的 `wiki-links.ts` 解析、`markdown.ts` 渲染。目标须是 `site-terms.json` 中未删除的词条（含别名）或本批已确认候选（规范名与别名）。`[[词条|视角@诠释者]]` 的诠释者须是站上诠释者或本工作目录的诠释者，且该视角存在于站上（或属于本批）。`wikilink.reserved-at`：词条名含 `@`、`@` 前无显示文字、`@` 后无诠释者、显示文字中含第二个 `@`。
- 引文逐字回查：`assembled.json` 的 `markdownSha256` 与当前稿一致时，按其记录的摘录引用从冻结段落重新取引文，与站点渲染出的可见文字、强调和出处逐项比对。稿子被改过（哈希不一致）时退化为：引文须是某个范围内冻结段落的逐字子串，出处须与该段落相符。
- 资料覆盖范围：由实际引用推导（与 assemble 同一套文案），「资料覆盖范围」「译本」两个列表须与之完全一致；缺项、多项、文字不同都报 `coverage`。
- 伪诠释者：工作目录、论点映射、assembled.json 的诠释者名、来源著者、双链里的诠释者名，命中 `isPseudoInterpreter` 即报。
- 锁定段落：`locks.json`（`LockInfo`，#111 产生；不存在即无锁定）。每个锁定块的 `text` 必须仍作为稿子的某个顶层块逐字存在（位置可以移动）；块的切法与哈希见 `blocks.ts` 的 `topLevelBlocks`，#111 生成锁定信息时须用同一函数。`LockInfo.headRevisionId` 须等于 `assembled.json` 的 `baseRevisionId`（若有）。
- 错误码：`UNCONFIRMED`（缺省全部概念时）、`MISSING_INPUT`、`OVERRIDES_INVALID`、`VALIDATE_NOTHING`、`ASSEMBLE_SOURCE_TAMPERED`。

### 审稿报告的落盘位置

审稿由会话中全新上下文的子代理执行，不由本命令执行。报告写到 `perspectives/<key>/review.json`（`ReviewReport`），其 `perspectiveSha256` 必须是被审阅的 `perspective.md` 的 sha256。稿子重新组装或被改动后，报告即过期，须重审。`validate` 在每个概念的输出行里给出 `review: {status: missing|stale|current, blockers}`，但不把审稿结果计入 `ok`；提交器（#112）应把当前的审稿报告与 `validation.json` 摘要一并写入提交说明，并拒绝过期的报告。
