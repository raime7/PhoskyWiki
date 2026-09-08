# R01: 图谱提示框安全显示文本

> 已发布：https://github.com/raime7/PhoskyWiki/issues/19。优先级：P1。对应 Spec 用户故事：1–3。

## Parent

https://github.com/raime7/PhoskyWiki/issues/18

## What to build

读者在局部与全站图谱悬停节点时安全阅读标题和学派信息，并能继续点击进入词条。

遵循父 Spec 与 ADR-0001～0004；每项功能连同相关接口、页面及外部行为测试一起交付。测试以 HTTP 和渲染 DOM 为主，使用隔离的真实 PostgreSQL；纯函数测试仅作补充。

## Acceptance criteria

- [ ] 所有来自内容的动态提示框字段按文本处理；保留必要静态格式，不以禁止标题字符代替输出修复。
- [ ] 局部与全站图谱采用同一规则，历史名称无需重新提交即可正确显示。
- [ ] 浏览器使用无害标记及特殊字符验证：不生成注入 DOM、不产生脚本副作用或名称触发的外部资源请求。
- [ ] 浏览器验证节点信息、悬停与点击跳转仍可用；回归覆盖两种图谱。

## Blocked by

None (can start immediately).


