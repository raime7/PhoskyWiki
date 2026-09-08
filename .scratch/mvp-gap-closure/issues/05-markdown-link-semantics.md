# R05: 预览与发布采用一致的双链语义

> 已发布：https://github.com/raime7/PhoskyWiki/issues/23。优先级：P2。对应 Spec 用户故事：26–28。

## Parent

https://github.com/raime7/PhoskyWiki/issues/18

## What to build

编者在代码示例中讲解双链语法不会建立虚假引用，正文真实双链在预览、发布与导航统计中保持一致。

遵循父 Spec 与 ADR-0001～0004；每项功能连同相关接口、页面及外部行为测试一起交付。测试以 HTTP 和渲染 DOM 为主，使用隔离的真实 PostgreSQL；纯函数测试仅作补充。

## Acceptance criteria

- [ ] 保存提取与 Markdown 渲染共享语法树语义，只提取真实 wiki-link 节点；围栏及缩进代码、行内代码、转义示例不建立关系。
- [ ] 普通双链、显示别名和显式视角语法保留原语义，按目标去重并保序。
- [ ] 受理、管理员直编和回滚复用修订生效管线；预览不另建一套正则解析。
- [ ] 真实链接贡献反链、热度、图谱与写作缺口，示例不贡献；混合正文通过 HTTP/DOM 验证，纯函数测试作补充。
- [ ] 修订重建时保留仍有效的已解析目标身份，不能因源文保留改名前名称而变为错误目标或红链。
- [ ] 本工单保证后续写入行为；历史内容批量校对由 R10 交付。

## Blocked by

None (can start immediately).


