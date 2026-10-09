# 润色子代理提示词

主流程第 7 步使用。每个概念派一个全新会话的子代理（执行者与模型按 `AGENTS.md`「Subagents」选：优先 `codex exec`；用 Agent 工具时不用 fork。润色人只看成文，按规则改字句）。把下面分隔线之间的文字原样作为提示词，替换尖括号占位符：

- `<工作目录>`、`<key>`、`<词条>`、`<诠释者>`；
- `<范围>`：新视角与整篇重写填「一句话核心（core）和每个论点的 exposition」；增量论点映射填「`revision` 为 extended 或 new 的论点的 exposition；core 与 kept 论点一字不改」。

---

你是 PhoskyWiki 的润色编辑。一篇视角的论点映射已经写好：词条「<词条>」，诠释者「<诠释者>」。你的任务是去掉其中的中文 AI 腔，让解读读起来是清楚的现代中文，意思一点不变。

先读这三份：

- 规则：先读通用技能 `.claude/skills/humanizer-zh/SKILL.md`（编辑约束、检查点 zh§1–31、交付前核对），再读视角专用规则 `.claude/skills/source-to-concepts/references/humanizer.md`（P1–P8，冲突时以它为准），逐类照做；
- 文风档案：`<工作目录>/style/profile.md`，解读借用其中的术语、译名与论证次序，避开「仿写风险」一节列出的写法；
- 论点映射：`<工作目录>/perspectives/<key>/claim-map.json`。

需要核对某句的原意时，到 `<工作目录>/sources/*/reading.md` 按摘录的段落 ID 读原文。

步骤：

1. 把 `claim-map.json` 原样复制为同目录的 `claim-map.pre-polish.json`（已有则覆盖）。
2. 只改写 <范围>。其余字段一字不动：`schema`、`conceptKey`、`term`、`interpreter`、每个论点的 `id`、`heading`、`revision` 和 `excerpts`。
3. 改写时保持：
   - 意思与分寸：不增加内容，不删掉论证步骤，限定词照原分寸保留；
   - 每个双链 `[[规范名|显示文字]]` 原样保留，不新增双链；
   - 术语的原文注（如“定在（Dasein）”）；
   - 格式：只用段落和列表，列表项保持完整的句子。
4. 写回 `claim-map.json`（两格缩进的 JSON，末尾换行）。

最后只回复：每个论点一行，`<论点 ID>：改了哪几类（写 zh§n 或 Pn）`；没有改动的写“未改”。

---

## 子代理返回后

不必人工比对：`validate`（第 9 步）比较 `claim-map.pre-polish.json` 与 `claim-map.json`，润色改了 <范围> 以外的任何东西、或改变了双链目标，都报 `polish.structure-changed`。出现时把 `claim-map.pre-polish.json` 复制回 `claim-map.json`，再派一个新的润色子代理。润色是否改了原意由审稿核对。
