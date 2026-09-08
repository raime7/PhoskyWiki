# 一次性 MVP 内容归并

先执行数据库迁移，再对目标数据库预览。命令默认只读盘点：

```sh
pnpm db:migrate
pnpm content:consolidate --database phoskywiki
```

确认输出的主机、端口、数据库及数量，使用普通 PostgreSQL 备份工具备份该目标库。停止内容写入后执行归并；本地 Docker 示例：

```sh
docker exec phoskywiki-postgres pg_dump -U phosky -d phoskywiki -Fc -f /tmp/phoskywiki-before-consolidation.dump
docker cp phoskywiki-postgres:/tmp/phoskywiki-before-consolidation.dump ./phoskywiki-before-consolidation.dump
pnpm content:consolidate --database phoskywiki --apply --backup ./phoskywiki-before-consolidation.dump
```

备份包含账户和内容，应放在访问受限、未纳入 git 的运维目录。`--backup` 验证文件存在且非空；操作者负责备份与目标库匹配。脚本不输出数据库密码。

内置组只归并“价值（政治经济学）”“价值（哲学）”到“价值”。其他已明确同名组通过 `--groups <JSON 文件>` 提供 `[{"title":"统一名称","sourceTitles":["来源名称一","来源名称二"]}]`，不会自动截断所有括号标题。

整个批次在锁定内容表的事务中执行，锁等待超过 5 秒则失败。事务失败可重试；成功后全量重建搜索。若搜索不可用，数据库归并已提交，恢复搜索服务后执行 `pnpm search:reindex`。其他发现数据从归并后的关系即时派生，无独立档案。

删除的楼层下若存在公开回复，将回复提升为楼层保留。正常保留页的历史与待审提案不清空；删除源的提交谱系依赖解除，来源待审提案不会被发布。共享图片保持原状。

导入 JSON 新项继续使用 `terms` / `interpreters` 数组。更新既有信息框时显式提供 `pageId` 和 `title`；省略 `summary`、`aliases`、`keyTexts` 保留现值，明确 `keyTexts: []` 清空。作品形状为 `{title, author?, year?, url?}`，年份为文本；链接支持 HTTP(S)。
