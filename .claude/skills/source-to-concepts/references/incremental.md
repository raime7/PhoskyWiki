# 增量更新

诠释者加入新书、候选清单里该概念有 `existingPerspective` 时读。目标是让视角越来越完整而不是越来越长：新材料按论点并入现有解读，以当前 head 修订为 base 提交编辑。命令行为与错误码见 `scripts/book-pipeline/README.md`「增量更新」。

## 准备

- 旧书与新书冻结在同一个工作目录。旧书用当初的书名、译者和范围冻结：既有摘录要靠出处行和句子范围在冻结来源里逐字定位，对不上即 `INCREMENTAL_EXCERPT_UNRESOLVED`。
- 导出两份 Markdown：该视角的当前 head 修订，以及最近一次由 AI 编者账号产生的修订（`GET /api/pages/<pageId>/history` 返回各修订的 `content` 与 `createdBy`）。从无 AI 修订时用 `--no-last-ai`，正文将全部锁定。

## 步骤

1. 导入现有视角，得到锁定信息和骨架：

   ```bash
   pnpm book-pipeline incremental --workdir <dir> --key <key> \
     --head head.md --head-revision <id> (--last-ai ai.md --last-ai-revision <id> | --no-last-ai)
   ```

   命令写 `base.json`、`locks.json`，并在输出的 `scaffold` 里给出增量论点映射的起点。head 不符合模板（`INCREMENTAL_HEAD_TEMPLATE`，如试点时期的旧格式视角）时无法增量，只能用 `assemble --key <key>` 整篇重写成编辑稿；先征得站长同意。
2. 以 `scaffold` 为底写 `perspectives/<key>/claim-map.json`（规则见下），写作规范同 [解读写作规范](writing.md)。
3. 并稿：`pnpm book-pipeline incremental --workdir <dir> --key <key>`（省略 `--head` 即沿用 `base.json`）。之后回到主流程的校验、审稿、提交。

## 增量论点映射的规则

- `core` 逐字照抄 head；既有论点按 head 原顺序、用原标题各出现一次。
- 新材料没有涉及的论点标 `kept`：`exposition` 为空，`excerpts` 为空。已受理的措辞原样保留。
- 新材料补充了某个论点就标 `extended`：`exposition` 只写追加的解读，`excerpts` 只列新增的摘录；程序把它们接在原解读、原摘录之后。
- 新书提出的新主张写成 `revision: "new"` 的论点，可放在任意位置，标题不与既有论点重复。
- 既有论点不删、不改写、不调换顺序；`locks.json` 里的人工改过的块更是原样保留。
- 新摘录的出处行自动以《书名》标明出自哪本书，资料覆盖范围和译本按全部引用重新推导。

既有正文已经占用了上限额度，追加时更要节制：优先把新材料并入既有论点，只为真正新的主张开新论点。合并后超限且无法再压缩时，交站长决定是否放行。
