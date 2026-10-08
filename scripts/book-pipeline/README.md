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
