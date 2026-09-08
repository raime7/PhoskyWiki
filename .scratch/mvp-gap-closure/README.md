# 一期 MVP 修复工单

父 Spec：https://github.com/raime7/PhoskyWiki/issues/18

状态：已按确认方案发布 11 张 GitHub 工单，全部标记 ready-for-agent，并核验 11 个父子关联及 12 条原生阻塞关系。父 Spec 的正文、标题、状态与标签保持原样。

1. [R01：图谱提示框安全显示文本](issues/01-graph-safe-text.md) — 阻塞：无。读者在局部与全站图谱悬停节点时安全阅读标题和学派信息，并能继续点击进入词条。

2. [R02：审核回归改为验证外部行为](issues/02-review-behavior-tests.md) — 阻塞：无。维护者从公开审核结果、修订历史和内容表现验证既有工作流，内部表布局调整不再破坏行为测试。

3. [R03：删除与恢复后的视角入口一致](issues/03-perspective-visibility.md) — 阻塞：无。删除视角、词条或诠释者后，读者在所有公开入口看到一致的不可用状态；恢复后有效关系自动恢复。

4. [R04：父页面失效时拒绝发布新视角](issues/04-approval-parent-validity.md) — 阻塞：R03。管理员受理新视角时若词条或诠释者已经删除，提交明确驳回并通知编者，不产生已受理却不可阅读的内容。

5. [R05：预览与发布采用一致的双链语义](issues/05-markdown-link-semantics.md) — 阻塞：无。编者在代码示例中讲解双链语法不会建立虚假引用，正文真实双链在预览、发布与导航统计中保持一致。

6. [R06：词条信息编辑、审核与改名闭环](issues/06-term-metadata-edit.md) — 阻塞：无。编者从词条页编辑标题、简介和别名，经审核后公开；管理员可以直编，改名后原有引用继续可达。

7. [R07：词条信息历史比较与安全回滚](issues/07-term-metadata-history.md) — 阻塞：R06。管理员查看和比较词条元数据历史，并通过生成新修订恢复到可恢复的历史快照。

8. [R08：从驳回记录继续修改并重提](issues/08-rejected-resubmission.md) — 阻塞：R06。编者从自己的驳回详情带回完整提案，结合最新内容修改后产生独立的新提交，失败时保留草稿。

9. [R09：游客三类兴趣驱动排序与推荐](issues/09-guest-interests.md) — 阻塞：无。游客选择诠释者、学派或主题后，词条页按与账号相同的规则重排视角及相关词条，无需登录。

10. [R10：校对存量双链并保留目标身份](issues/10-historical-link-repair.md) — 阻塞：R05、R06。管理员可重复校对既有正文，清除代码示例造成的虚假引用，保留改名前已解析的真实链接及所有历史修订。

11. [R11：一期修复组合验收与交付证据](issues/11-mvp-closure-verification.md) — 阻塞：R01、R02、R04、R07、R08、R09、R10。维护者依据 Spec #18 的完整验收矩阵判断本批缺口是否关闭，读者与编者的跨模块流程有可复现的验证证据。

优先处理 R01；R02 可先整理现有回归。优先级与建议顺序不额外生成阻塞边。当前可开始：R01、R02、R03、R05、R06、R09。


## 已发布工单

- [[R01] 图谱提示框安全显示文本](https://github.com/raime7/PhoskyWiki/issues/19)；阻塞：无。
- [[R02] 审核回归改为验证外部行为](https://github.com/raime7/PhoskyWiki/issues/20)；阻塞：无。
- [[R03] 删除与恢复后的视角入口一致](https://github.com/raime7/PhoskyWiki/issues/21)；阻塞：无。
- [[R04] 父页面失效时拒绝发布新视角](https://github.com/raime7/PhoskyWiki/issues/22)；阻塞：#21。
- [[R05] 预览与发布采用一致的双链语义](https://github.com/raime7/PhoskyWiki/issues/23)；阻塞：无。
- [[R06] 词条信息编辑、审核与改名闭环](https://github.com/raime7/PhoskyWiki/issues/24)；阻塞：无。
- [[R07] 词条信息历史比较与安全回滚](https://github.com/raime7/PhoskyWiki/issues/25)；阻塞：#24。
- [[R08] 从驳回记录继续修改并重提](https://github.com/raime7/PhoskyWiki/issues/26)；阻塞：#24。
- [[R09] 游客三类兴趣驱动排序与推荐](https://github.com/raime7/PhoskyWiki/issues/27)；阻塞：无。
- [[R10] 校对存量双链并保留目标身份](https://github.com/raime7/PhoskyWiki/issues/28)；阻塞：#23、#24。
- [[R11] 一期修复组合验收与交付证据](https://github.com/raime7/PhoskyWiki/issues/29)；阻塞：#19、#20、#22、#25、#26、#27、#28。

