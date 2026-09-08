## Destination

明确一期 MVP 后续修复路线：解决 main `164cd6c` 审查中的行为与测试问题，以同名词条直接归并替代独立消歧义，并将关键文本确定为可选信息。目的地是可交给实施任务的规格，不是在本地图中开发或清理数据库。

## Notes

- 产品方向及兼容取舍已由用户决定；使用 wayfinder 完成收束，下一步使用 to-spec 发布实施规格。
- 实施交接已完成：[Spec: 一期 MVP 收束——同名词条归并、可选关键文本与行为修复](https://github.com/raime7/PhoskyWiki/issues/33)，标记 ready-for-agent。
- 原规格：[Spec: 一期 MVP —— 词条 × 视角的原子笔记 WIKI（审核流/三轴导航/讨论区/BYOK Agent）](https://github.com/raime7/PhoskyWiki/issues/1)。
- 后续同时修复编辑起点快照、讨论锚点有效性、搜索回复定位、CLI 搜索隔离及内部实现断言问题。
- 测试沿用一期已约定的 HTTP/SSR 主缝、真实 PG、外部服务 fake 与独立契约，不增加测试体系。
- 地图完成仅表示决策完成，不表示产品修复或数据迁移已执行。

## Decisions so far

- [决策：关键文本如何兼容旧修订、待审提案与导入](https://github.com/raime7/PhoskyWiki/issues/32)：关键文本可选，管理员判断内容质量，沿用简单缺省语义。
- [决策：存量同名页面如何归并并保留历史与入口](https://github.com/raime7/PhoskyWiki/issues/31)：同名内容直接归并，清理隐藏及废弃来源记录，撤下复杂长期兼容要求。

## Not yet specified

无剩余产品决策。具体数据库记录与受影响数量由实施阶段读取实际目标库确定，属于迁移检查，不新增产品议题。

## Out of scope

- 独立消歧义编辑器、独立作品页、领域实体、通用合并管理平台。
- 隐藏来源档案、跨页旧历史浏览、撤销合并与永久旧入口兼容系统。
- 全库历史或待审提案清空、擅自改变以后全站删除语义。
- 二期功能与生产部署。
