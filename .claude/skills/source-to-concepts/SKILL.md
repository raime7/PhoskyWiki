---
name: source-to-concepts
description: 用书籍流水线（pnpm book-pipeline）把诠释者著作的中译本整理成词条视角：冻结来源、候选与准入、论点映射与解读写作、组装、审稿子代理、校验、提交；也用于诠释者新书的增量并入。普通摘要或站内内容同步不适用。
---

# 从原典生成视角

会话做判断（候选、论点、解读、派出审稿），`pnpm book-pipeline` 做其余一切。视角正文是按**论点**组织的**解读**，每个论点配对 1–3 段**原文摘录**（`CONTEXT.md` 术语；ADR-0009、ADR-0007）。命令与参数以 `pnpm book-pipeline help` 为准；产物布局、错误码和各命令细则在 `scripts/book-pipeline/README.md`；每个会话产物的字段在 `scripts/book-pipeline/types.ts`，照它写，不另造格式。

## 不变的约束

- **引文只给位置。** 摘录一律写成 `{ "paragraph", "from", "to" }`（段落 ID + 起止句号），引文文字由程序从冻结来源回填。
- **诠释者是著作的著者。** 一个工作目录服务一位诠释者；二手研究归研究者本人的工作目录。AI 只是编者：诠释者署名和双链的 `@诠释者` 只用真实思想家，“编委会”“编者”“AI”之类一律不作诠释者（`types.ts` 的 `isPseudoInterpreter` 会拒绝）。
- **站长是闸门。** 候选清单的确认、超限放行、正式提交，都要站长在对话里明确同意后才执行。
- **工作目录放在仓库外。** 里面是受版权保护的全文。

## 流程

### 1. 定边界

承接会话里已定的书、译本、章节范围、诠释者和工作目录，只问缺失的。站上已有该诠释者依据旧书生成的视角时，新书走增量（第 5 步的分支），旧书也要冻结进同一个工作目录。完成条件：上述各项都有确定值。

### 2. 冻结

```bash
pnpm book-pipeline freeze <file> --toc
pnpm book-pipeline freeze <file> --workdir <dir> --id <sourceId> --title … --author <诠释者> --translator … --edition … --from … --to …
```

通读 `sources/<id>/reading.md`，核对章节起止、层次（正文/说明/附释/注）和注释配对。层次或节号切错时，`pnpm book-pipeline rules` 另存一份、修改后用 `--rules` 重冻；下游产物已引用旧 ID 时不要 `--force`。完成条件：范围内每段的层次与节号和原书一致。

### 3. 候选

通读全部 `reading.md`，写 `candidates/session-candidates.json`（`SessionCandidates`）：

- `treatment`：诠释者**专门论述**的概念标 `dedicated`；顺带提及的标 `mention`，它们只在别的解读里做双链。
- 准入门槛（程序执行）：`dedicated`，且有效 `proposedClaims` ≥ 2 或 `centralParagraphs` ≥ 1。每个拟定论点写一句 `summary` 和依据段落 ID。
- 同一概念的译名变体、别名合并为一个候选，记入 `aliases` 与 `mergedFrom`；含义相关但不相同的放进 `related`。拿不准是否相同，就问站长。

再准备 `candidates/site-terms.json`（`SiteExport`：站上全部词条及别名、诠释者、视角及其 head 修订）。流水线没有导出命令，按 [发布与站点](references/phoskywiki.md) 只读导出。然后：

```bash
pnpm book-pipeline candidates --workdir <dir>
```

`AMBIGUOUS_TERM`、`DUPLICATE_CONCEPT` 回到会话产物里合并或改 `related`，重跑。完成条件：退出码 0。

### 4. 站长确认

把 `candidates/candidates.json` 整理成表交给站长：规范名、别名、命中的已有词条与视角、论点数、依据段落；`excluded` 连同原因一并列出。等站长回复要哪些，再用站长的名字确认：

```bash
pnpm book-pipeline confirm --workdir <dir> --by <站长名> --keys a,b   # 或 --all
```

此后重跑 `candidates` 会使确认失效，需要重新确认。

### 5. 写论点映射

逐个确认的概念写 `perspectives/<key>/claim-map.json`（`ClaimMap`）。动笔前读 [解读写作规范](references/writing.md)，它规定模板、硬上限、解读怎么写、双链与摘录怎么选。

- 新视角：全部论点 `revision: "new"`，然后 `pnpm book-pipeline assemble --workdir <dir> [--key <key> …]`。
- 候选清单里有 `existingPerspective` 的概念：读 [增量更新](references/incremental.md)，用 `incremental` 命令并稿。assemble 会把它们整篇重写成新稿、丢掉已受理的措辞，所以工作目录里有这类概念时，assemble 一律用 `--key` 点名新视角。

### 6. 校验

```bash
pnpm book-pipeline validate --workdir <dir> [--key <key> …]
```

`error` 类发现项改 claim-map 后回到第 5 步重新组装。`limit` 类先压缩到上限内；确有必要的例外交给站长决定，站长同意后写 `perspectives/<key>/overrides.json`（`LimitOverride[]`，`approvedBy` 填站长）。完成条件：每个概念 `ok: true`。

### 7. 审稿

每个概念派一个**全新上下文**的子代理（Agent 工具），提示词取自 [审稿子代理提示词](references/review-prompt.md)，按其中说明填入占位符。它只读 `perspective.md` 与冻结来源，写出 `perspectives/<key>/review.json`。

有 `blocker` 或你认同的 `warning`：改 claim-map → 重新组装 → 校验 → 再派新的子代理审稿（稿子一变，旧报告即过期）。完成条件：`validate` 输出里每个概念 `review.status` 为 `current`，且 `blockers` 为 0。

### 8. 提交

```bash
pnpm book-pipeline submit --workdir <dir>          # 试运行：写 submit/plan.json
```

把试运行清单交给站长核对；获授权后按 [发布与站点](references/phoskywiki.md) 用 `--send` 分两阶段提交。

## 交付

向站长报告：每个概念的状态（已确认 / 已组装 / 校验 ok / 审稿 current / 已提交及 opKey），被排除的候选及原因，放行项，审稿中你没采纳的意见及理由，仍待站长决定的事。自动校验与审稿通过不等于站长的语义评阅；把逐篇审读留给站长。
