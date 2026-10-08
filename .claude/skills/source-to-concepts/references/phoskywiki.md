# 发布与站点

导出站点数据、正式提交、提交后核验时读。操作远端前另读 `docs/production.md`（仅本地）。先确认本次面对的是哪个站点和数据库，后面每个命令都用同一个 origin。

## 导出 `site-terms.json`

流水线不连数据库，`candidates/site-terms.json` 由会话只读导出，形状为 `types.ts` 的 `SiteExport`：全部词条（标题、slug、别名、`deleted`）、诠释者、视角（`termId`、`interpreterId`、`headRevisionId`、`deleted`）。已删除的也要列出并标 `deleted: true`。只用只读查询，不写目标库。

导出时顺便核对现状：站上没有“编委会”之类的伪诠释者视角（迁移 0019 已删除），该诠释者是否已有页面，同名或别名冲突的词条。发现异常先报告站长。

## 提交

提交走站点的审核管线（ADR-0004），使用专用的 AI 编者账号：角色只能是 `editor`，提交才会进入队列、照常受理；管理员角色会让内容直接生效，`submit --send` 也会拒绝。账号由站长按现有用户管理流程创建，凭据经环境变量 `BOOK_PIPELINE_EMAIL`、`BOOK_PIPELINE_PASSWORD` 传入，不写进文件。

```bash
pnpm book-pipeline submit --workdir <dir> --origin <站点> [--key <key> …]          # 试运行，写 submit/plan.json
pnpm book-pipeline submit --workdir <dir> --origin <站点> --send                   # 站长授权后
pnpm book-pipeline submit --workdir <dir> --origin <站点> --reconcile <opKey>=<pageId> …
```

- `--origin` 缺省是 `http://localhost:3000`，提交到其他站点时必须显式给出。
- 门禁：每个概念须已确认、校验通过（或已放行）、审稿报告与当前稿一致且无 blocker，否则整条命令拒绝、不写任何文件。
- 两阶段：`--send` 先发新诠释者和新词条（`new_interpreter:…`、`new_term:…`），它们进入审核队列。管理员受理后，用 `--reconcile <opKey>=<pageId>` 把站上生成的页面 ID 记入账本，再 `--send` 发出依赖它们的视角。不要靠刷新 `site-terms.json` 重跑 `candidates` 来代替：清单一变，确认就失效。
- 提交说明由程序从 `review.json` 和 `validation.json` 生成，审核者在审核页能看到。
- `submit/ledger.jsonl` 是只追加的写入账本，不手改。`LEDGER_AMBIGUOUS`（发出后结果未知）时先到站上查实际结果，存在则 `--reconcile`，再继续；已提交的内容改动后要重发，用 `--resubmit <opKey>`。
- 站点写入限额是每个账号每分钟 60 次，`--rate` 缺省即 60，只往低调。

## 提交后

受理后在站上核对：视角挂在正确的词条和诠释者下，引文、强调和出处显示正常，双链跳转正确，红链都有原因。向站长交付已提交的 opKey 与对应的提交或页面 ID。

用新流程重做旧试点时（如《小逻辑》A．质），不达准入门槛的旧视角，以及因此失去全部视角的词条，由管理员在站上走正常软删除。流水线不做这一步；逐项列出，由站长授权执行。
