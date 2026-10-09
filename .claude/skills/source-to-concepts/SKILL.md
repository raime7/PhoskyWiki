---
name: source-to-concepts
description: 用书籍流水线（pnpm book-pipeline）把诠释者著作的中译本整理成词条视角：冻结来源、候选与准入、文风档案、论点映射与解读写作、润色、组装、校验、审稿子代理、提交；也用于诠释者新书的增量并入。普通摘要或站内内容同步不适用。
---

# 从原典生成视角

会话做判断（候选、文风档案、论点、解读、派出润色与审稿），`pnpm book-pipeline` 做其余一切。顺序：freeze → export-site → 写候选 → candidates → confirm → 文风档案 → 论点映射 → 润色 → assemble / incremental → validate → 审稿 → submit。视角正文是按**论点**组织的**解读**，每个论点配对 1–3 段**原文摘录**（`CONTEXT.md` 术语；ADR-0009、ADR-0007）。命令与参数以 `pnpm book-pipeline help` 为准；产物布局、错误码和各命令细则在 `scripts/book-pipeline/README.md`；每个会话产物的字段在 `scripts/book-pipeline/types.ts`，照它写。

## 不变的约束

- **引文只给位置。** 摘录一律写成 `{ "paragraph", "from", "to" }`（段落 ID + 起止句号），引文文字由程序从冻结来源回填。解读借用诠释者的术语、译名和论证次序，句子是清楚的现代中文：原文只经摘录进入视角。
- **诠释者是著作的著者。** 一个工作目录服务一位诠释者；二手研究归研究者本人的工作目录。AI 只是编者：诠释者署名和双链的 `@诠释者` 只用真实思想家（`types.ts` 的 `isPseudoInterpreter` 会拒绝“编委会”“编者”“AI”之类）。
- **站长是闸门。** 候选清单的确认、超限放行、正式提交，都要站长在对话里明确同意后才执行。
- **工作目录放在仓库外。** 里面是受版权保护的全文。

## 流程

### 1. 定边界

承接会话里已定的书、译本、章节范围、诠释者和工作目录，只问缺失的。站上已有该诠释者依据旧书生成的视角时，新书走增量（第 6、8 步的分支），旧书也要冻结进同一个工作目录。完成条件：上述各项都有确定值。

### 2. 冻结

```bash
pnpm book-pipeline freeze <file> --toc
pnpm book-pipeline freeze <file> --workdir <dir> --id <sourceId> --title … --author <诠释者> --translator … --edition … --from … --to …
```

通读 `sources/<id>/reading.md`，核对章节起止、层次（正文/说明/附释/注）和注释配对。层次或节号切错时，`pnpm book-pipeline rules` 另存一份、修改后用 `--rules` 重冻；`--force` 只用在下游产物尚未引用旧 ID 的时候。完成条件：范围内每段的层次与节号和原书一致。

### 3. 候选

通读全部 `reading.md`，写 `candidates/session-candidates.json`（`SessionCandidates`）：

- `treatment`：诠释者**专门论述**的概念标 `dedicated`；顺带提及的标 `mention`，它们只在别的解读里做双链。
- 准入门槛（程序执行）：`dedicated`，且有效 `proposedClaims` ≥ 2 或 `centralParagraphs` ≥ 1。每个拟定论点写一句 `summary` 和依据段落 ID。
- 同一概念的译名变体、别名合并为一个候选，记入 `aliases` 与 `mergedFrom`；含义相关但不相同的放进 `related`。拿不准是否相同，就问站长。
- 站上还没有的词条，写 `termSummary`：一句中性的词条简介，说明这个概念指什么，供新建词条使用（如“定在：有规定的存在，……”）。诠释者怎么理解它属于视角的一句话核心，留给第 6 步。已有词条写 `null`。

然后导出站上现状（只读，游客权限）并生成候选清单：

```bash
pnpm book-pipeline export-site --workdir <dir> --origin <站点>   # 写 candidates/site-terms.json
pnpm book-pipeline candidates --workdir <dir>
```

`AMBIGUOUS_TERM`、`DUPLICATE_CONCEPT` 回到会话产物里合并或改 `related`，`TERM_SUMMARY_MISSING` 补上 `termSummary`，重跑。完成条件：退出码 0。

### 4. 站长确认

把 `candidates/candidates.json` 整理成表交给站长：规范名、别名、命中的已有词条与视角、论点数、依据段落；`excluded` 与 `blocked`（与已删除词条同名，需站长先在站上恢复该词条）连同原因一并列出。等站长回复要哪些，再用站长的名字确认：

```bash
pnpm book-pipeline confirm --workdir <dir> --by <站长名> --keys a,b   # 或 --all
```

此后重跑 `candidates` 会使确认失效，需要重新确认。

### 5. 文风档案

按 [文风档案](references/style-profile.md) 写 `style/profile.md`：术语与译名、论证次序、推理与转折、仿写风险。增量运行时沿用已有档案，只为新书追加。完成条件：该参考末尾的完成条件。

### 6. 写论点映射

逐个确认的概念写 `perspectives/<key>/claim-map.json`（`ClaimMap`）。动笔前读 [解读写作规范](references/writing.md)，它规定模板、硬上限、解读怎么写、双链与摘录怎么选；写时对照文风档案。

- 新视角：全部论点 `revision: "new"`。
- 候选清单里有 `existingPerspective` 的概念：读 [增量更新](references/incremental.md)，按它导入 head、拿到骨架后写增量论点映射，已受理的措辞因此原样保留。整篇重写只用于 head 无法增量的情形，经站长同意后走 `assemble --rewrite <key>`。

### 7. 润色

每个概念派一个**全新上下文**的润色子代理，提示词取自 [润色子代理提示词](references/polish-prompt.md)，按其中说明填入占位符。它按通用技能 humanizer-zh 加 [视角专用规则](references/humanizer.md) 只改写一句话核心与解读（增量时只改 `extended`、`new` 论点的解读），论点 ID、标题、摘录和双链不动。完成条件：`claim-map.pre-polish.json` 已写出、`claim-map.json` 已改写。润色只改了文字由第 9 步的 `validate` 检查（`polish.missing`、`polish.structure-changed`），意思未变由审稿检查。

### 8. 组装

- 新视角：`pnpm book-pipeline assemble --workdir <dir> [--key <key> …]`。
- 增量：`pnpm book-pipeline incremental --workdir <dir> --key <key>` 并稿。assemble 缺省跳过这类概念（用 `--key` 点名会被拒绝）；整篇重写用 `assemble --rewrite <key>`。

完成条件：退出码 0。

### 9. 校验

先校验、后审稿（#105 列的顺序是审稿在前）：审稿报告绑定稿子的哈希，校验不过就要改稿重组装，先审的报告会随即过期。

```bash
pnpm book-pipeline validate --workdir <dir> [--key <key> …]
```

改稿一律回到第 6 步改 claim-map，再润色、组装、校验。

- `error` 不可放行。其中 `exposition.verbatim-source` 是解读照录了原文：用自己的话讲，或把那句改成摘录。`style.profile-missing` 回第 5 步补齐文风档案；`polish.missing`、`polish.structure-changed` 回第 7 步重新润色。
- `limit` 先压缩到上限内；确有必要的例外交给站长决定，站长同意后写 `perspectives/<key>/overrides.json`（`LimitOverride[]`，`approvedBy` 填站长）。
- `hints` 的 `style.ai-pattern` 不阻断：照 humanizer 改得掉的就改，留下的会列入提交说明。

完成条件：每个概念 `ok: true`，每条 hint 都改掉了或你能说出留下的理由。

### 10. 审稿

每个概念派一个**全新上下文**的子代理，提示词取自 [审稿子代理提示词](references/review-prompt.md)，按其中说明填入占位符。它只读 `perspective.md` 与冻结来源，写出 `perspectives/<key>/review.json`。

有 `blocker` 或你认同的 `warning`：改 claim-map → 润色 → 重新组装 → 校验 → 再派新的子代理审稿（稿子一变，旧报告即过期）。完成条件：`validate` 输出里每个概念 `review.status` 为 `current`，且 `blockers` 为 0。

### 11. 提交

```bash
pnpm book-pipeline submit --workdir <dir>          # 试运行：写 submit/plan.json
```

把试运行清单交给站长核对；获授权后按 [发布与站点](references/phoskywiki.md) 用 `--send` 分两阶段提交。

## 交付

向站长报告：每个概念的状态（已确认 / 已组装 / 校验 ok / 审稿 current / 已提交及 opKey），被排除的候选及原因，放行项，留下的文风提示及理由，审稿中你没采纳的意见及理由，仍待站长决定的事。自动校验与审稿通过不等于站长的语义评阅；把逐篇审读留给站长。
