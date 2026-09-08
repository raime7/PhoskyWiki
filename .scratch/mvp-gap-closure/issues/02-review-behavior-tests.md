# R02: 审核回归改为验证外部行为

> 已发布：https://github.com/raime7/PhoskyWiki/issues/20。优先级：P3。对应 Spec 用户故事：36。

## Parent

https://github.com/raime7/PhoskyWiki/issues/18

## What to build

维护者从公开审核结果、修订历史和内容表现验证既有工作流，内部表布局调整不再破坏行为测试。

遵循父 Spec 与 ADR-0001～0004；每项功能连同相关接口、页面及外部行为测试一起交付。测试以 HTTP 和渲染 DOM 为主，使用隔离的真实 PostgreSQL；纯函数测试仅作补充。

## Acceptance criteria

- [ ] 逐项替换审核测试中对投票、修订和双链内部行结构的断言，保留原业务规则覆盖。
- [ ] 通过提交详情、审核响应、修订历史、反链、引用热度或图谱结果验证受理后的效果；不新增仅供测试读取内部表的 API。
- [ ] 真实 PostgreSQL 只用于迁移、隔离及夹具准备；不 mock 数据库，不将数据库准备操作误删为内部断言。
- [ ] 既有两票、冷启动、任一驳回终态、过期基准、直编与双链生效行为回归通过；该工单不改变产品规则。
- [ ] 后续功能工单优先复用这些公开边界；这是可先行的测试整理，不构成其他工单必须等待的基础设施。

## Blocked by

None (can start immediately).


