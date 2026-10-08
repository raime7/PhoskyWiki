# 增量更新

诠释者加入新书、候选清单里该概念有 `existingPerspective` 时读。目标是让视角越来越完整而不是越来越长：新材料按论点并入现有解读，以当前 head 修订为 base 提交编辑。命令行为与错误码见 `scripts/book-pipeline/README.md`「增量更新」。

## 准备

- 旧书与新书冻结在同一个工作目录。旧书用当初的书名、译者和范围冻结：既有摘录要靠出处行和句子范围在冻结来源里逐字定位，对不上即 `INCREMENTAL_EXCERPT_UNRESOLVED`。
- 从站点导出该视角的当前 head 修订和最近一次 AI 编者账号产生的修订（只读，经修订历史接口），写入 `perspectives/<key>/base.json`：

  ```bash
  pnpm book-pipeline export-site --workdir <dir> --origin <站点> --key <key> --ai-user <AI 编者账号的用户 id>
  ```

  用户 id 见该账号任一修订在 `/api/pages/<pageId>/history` 里的 `createdBy`，或以该账号登录后 `/api/auth/get-session` 的 `user.id`。AI 账号从未编辑过该视角时，`lastAiRevisionId` 为 null，正文将全部锁定。

## 步骤

1. 导入现有视角，得到锁定信息和骨架：

   ```bash
   pnpm book-pipeline incremental --workdir <dir> --key <key>     # 沿用 export-site 写的 base.json
   ```

   命令写 `locks.json`，并在输出的 `scaffold` 里给出增量论点映射的起点。手头只有 Markdown 文件时，也可以用 `--head head.md --head-revision <id> (--last-ai ai.md --last-ai-revision <id> | --no-last-ai)` 直接导入。
   - head 不符合模板（`INCREMENTAL_HEAD_TEMPLATE`，如试点时期的旧格式视角）时无法增量：征得站长同意后用 `assemble --rewrite <key>` 整篇重写成以 head 为 base 的编辑稿（正常写全量论点映射）。
   - head 的资料说明（分隔线之后）被人改过时，命令拒绝（`INCREMENTAL_FOOTER_EDITED`），因为资料说明总按引用重新推导。把人工改动报告给站长：站长同意重新推导时，此后每次运行 `incremental` 都加 `--rederive-footer`；要保留的内容先搬进解读或请站长另行处理。
2. 以 `scaffold` 为底写 `perspectives/<key>/claim-map.json`（规则见下），写作规范同 [解读写作规范](writing.md)，沿用工作目录已有的文风档案。
3. 润色（主流程第 7 步）：范围只是 `extended`、`new` 论点的解读；`core` 照抄 head，与 kept 论点一样不动。
4. 并稿：`pnpm book-pipeline incremental --workdir <dir> --key <key>`（省略 `--head` 即沿用 `base.json`）。之后回到主流程的校验、审稿、提交。

## 增量论点映射的规则

- `core` 逐字照抄 head；既有论点按 head 原顺序、用原标题各出现一次。
- 新材料没有涉及的论点标 `kept`：`exposition` 为空，`excerpts` 为空。已受理的措辞原样保留。
- 新材料补充了某个论点就标 `extended`：`exposition` 只写追加的解读，`excerpts` 只列新增的摘录；程序把它们接在原解读、原摘录之后。
- 新书提出的新主张写成 `revision: "new"` 的论点，可放在任意位置，标题不与既有论点重复。
- 既有论点全部保留，标题、措辞和顺序都照旧；`locks.json` 里人工改过的块同样逐字留存。
- 新摘录的出处行自动以《书名》标明出自哪本书，资料覆盖范围和译本按全部引用重新推导。

既有正文已经占用了上限额度，追加时更要节制：优先把新材料并入既有论点，只为真正新的主张开新论点。合并后超限且无法再压缩时，交站长决定是否放行。
