# 0003 - 统一页面壳与 id 寻址

- 状态：已接受（Accepted）
- 日期：2026-09-04
- 关联：Amends [0001-mvp.md](../specs/0001-mvp.md)「核心数据模型」「双链语法」两条；依据 [ADR-0001](./0001-postgresql-as-content-store.md)（PG 唯一内容存储、关系查询是选库决定性理由）

## Context

一期有五种可寻址页面类型：词条页、视角页、诠释者页、学派页、消歧义页。修订（任意两版互比、回滚）、提交（审核队列）、软删除（可恢复）、讨论挂载、反链面板都以「页面」为操作对象——但 spec 0001 初版的实体清单没有统一的页面实体，修订/提交/软删缺少共同锚点，只能为每类实体各建一套基础设施。

业界对照（2026-09 调研）：MediaWiki、XWiki、Wiki.js、Outline、Notion、TiddlyWiki 全部采用「一切皆页面」的统一模型；分实体建表的 BookStack（books/chapters/pages 三表独立）是少数派，后果可考证——只有 page 拥有修订历史，书与章节无法复用基础设施。MediaWiki 同时是「名称锚定」的原点与反面教材：页面身份 = (namespace, title)，pagelinks 存的也是名称而非目标 id，由此派生出「移动 + 重定向」机器与 job queue 链接重算。Outline 的 URL 方案（`/doc/<slug>-<urlId>`）证明 id 锚定与可读 slug 可以兼得。

## Decision

1. **统一页面壳**：所有可寻址内容落 `pages(id, type, title, slug, deleted_at, created_by, …)`，type ∈ {term, perspective, interpreter, school, disambiguation}。修订、提交、讨论、软删除、反链一律挂 page_id。
2. **类型负载表（class-table inheritance）**：每类页面的专有字段放独立负载表，FK 到 page_id——`terms`、`interpreters`、`schools`、`perspectives(term_id, interpreter_id)`（唯一约束）。结构化查询留在强类型表里，不学 MediaWiki 把 infobox 藏进 wikitext。分类（categories）一期**不是**页面类型：弱类型标签树，无修订无讨论，分类树浏览是功能页而非实体页。
3. **URL = `/<type>/<slug>-<id>`**（Outline 式）：id 永不改变，改名只换 slug，旧链接永远可达；中文标题的 slug 生成失败时退化为纯 id。
4. **双链按 id 落库、保存时解析**：`links(source_page_id, target_page_id)`，解析发生在保存（受理产生修订）时；目标页不存在则 target_page_id 为空、保留 target_name 文本快照——即红链。「写作缺口」视图 = `target_page_id IS NULL` 聚合，无需单独的红链表。词条改名不影响任何既有链接。
5. **词条标题唯一**：按名称解析要求名称可无歧义解析。同名多义概念用括号限定标题（如「价值（政治经济学）」），消歧义页聚合同组词条。别名一期不参与解析（仅 infobox 展示），二期再议。
6. **消歧义页 = `type='disambiguation'` 的页面**（MVP 形态：列出同名词条分流入口的特殊页），不单独建模。
7. **软删除 = `deleted_at` 标记**，不做 MediaWiki 式 archive 物理搬迁（那套为修订级权限可见性设计，MVP 无此需求）；恢复 = 清除标记。

## Considered Options

- 各实体独立建表、不设页面壳（BookStack 路线）：被否——修订/提交/软删/讨论的基础设施要 ×5 份，新增页面类型即重做一遍，实证后果见 BookStack。
- 名称锚定 + 重定向机器（MediaWiki 路线）：被否——身份即名称会派生出整套移动/重定向/job queue 设施；id 锚定后改名天然不断链，重定向可推迟到确有需要时。
- 页面壳 + JSON 负载列（单表多态）：被否——丢失三轴导航/推荐/审核这些关系查询能力，而那正是 ADR-0001 选 PG 的决定性理由。

## Consequences

- 跨类型查询（全站图谱、全局修订流）经 pages 壳 join，多一跳；单类型热路径直接查负载表。
- 新增页面类型 = 一行 type 枚举 + 一张负载表，基础设施零改动。
- 保存时解析意味着受理时的解析结果即真相：解析器（含括号限定标题、精确视角语法）是写入路径的关键组件，须有单元测试锁定（对应 spec Testing Decisions 的纯函数层）。
- 中文 slug 的生成/退化规则需要实现（拼音转换或允许空 slug 仅用 id）。
- 标题唯一约束把「改名冲突」变成显式校验，落在受理时报错，而非静默顶掉。
