# #27 / R09 — 游客三类兴趣驱动排序与推荐

- 实现提交：`fd80cb8426a4a55abc0139e04d367d515ffa1c14` (`feat: share guest and account term discovery (#27)`)
- 分支：`codex/spec18-27`；基线：`e4ac015`，包含 #19/#20/#21/#22。
- 工作目录：`D:/PhoskyWiki-worktrees/spec18-27`；提交后 working tree clean。
- 仅使用隔离数据库 `phosky_spec18_27`，迁移通过；未操作主库或外部服务索引。

## 实现与验收证据

| 验收项 | 实现 / 正式回归证据 |
| --- | --- |
| 游客与账号共用兴趣语义 | `getTermDiscovery` 共用 `filterLiveInterests`、`expandInterestedInterpreters`、`reorderPerspectivesByInterest` 和 `listRelatedTerms`。HTTP 验证去重、有效对象过滤、学派展开、直接/学派重复命中不重复计分、失效及超出 int4 范围的正整数 id 静默过滤。 |
| 最多一个聚合只读端点 | 新增 `GET /api/terms/[id]/discovery?interests=<JSON>`，只返回当前词条的重排视角与相关词条及展开后的兴趣诠释者集合。沿用三类 id/每类50上限校验；非法 JSON/类型/id/超限返回400，不存在词条404。读取没有账号鉴权依赖或兴趣档案写入。 |
| 个性化缓存隔离 | 路由 force-dynamic、`Cache-Control: private, no-store`，客户端 fetch `cache: no-store`。HTTP 并发不同兴趣返回各自结果；真实 Next HTTP 验证响应为 `no-store, private`；浏览器独立 visitor context 保持默认结果。 |
| 编委会→置顶→兴趣→热度 | HTTP 对明确夹具验证编委会、置顶福柯、拉康/德勒兹/弗洛伊德兴趣、其余阿尔都塞顺序；浏览器既有 pin 回归通过。编委会正文仍在独立固定区块。 |
| 主题仅用于推荐 | HTTP/浏览器单选政治经济学把剩余价值排前，视角顺序与默认完全一致。学派法兰克福的相关词条计分经HTTP验证。 |
| 完整一跳候选先计分再截断 | `getDiscoveryGraph` 与展示图谱共用读取/BFS逻辑，但不应用400节点显示上限；现有 `getLocalGraph` 仍保留400上限。正式HTTP夹具创建401个邻居，第401个低热度分类匹配仍进入5条结果。排序保持兴趣分→共同引用→稳定id。 |
| 同页/跨tab/刷新 | `persistGuestInterests` 写成功后发送同页变更事件；`useGuestInterests` 同时订阅该事件与storage，缓存解析快照；游客选择器在写入成功后继续跟随外部快照。浏览器验证同页事件确实重排、真实第二标签页勾选/取消驱动主词条更新、刷新保留。 |
| 清空、坏数据、无效对象、请求失败 | 浏览器覆盖清空恢复默认，坏JSON及刷新仍可读，三类失效id请求成功但显示默认，网络请求中断回退默认且localStorage/已选checkbox保持，恢复网络刷新后再次生效。异步请求带AbortController和选择key，旧请求不能覆盖新选择。 |
| localStorage异常 | 浏览器将localStorage getter设为SecurityError；词条正常阅读、选择器不崩溃，已勾选选择留本页并明确显示无法保存。 |
| 游客/账号等价与原合并机制 | 浏览器先选三类组合记录完整视角/推荐DOM，然后注册→原本地兴趣带入提示→保存账号→重新访问词条，两个DOM序列完全相同。原登录兴趣测试及首页账号兴趣回归通过；未扩展游客首页。 |
| 统一可见性 | 推荐计分保留 #21 的 `isPageVisible`。HTTP隐藏兴趣诠释者的视角后不再计分；浏览器分别删除视角/词条/诠释者时公开链接、图谱、相关词条一致消失及恢复。 |

## TDD 与验证

已使用 implement/TDD，遵守已确认 HTTP/浏览器主缝；数据库仅作 seed、夹具和清理，没有内部行结构断言或测试专用API。

红绿证据：
- 新发现HTTP入口初始不存在；实现后学派展开用例通过。
- 第401邻居HTTP测试在展示图谱400截断下失败，改为完整候选后通过。
- 浏览器学派单选在旧实现得到阿尔都塞/拉康而非拉康/弗洛伊德，接入共享发现后通过。
- 非对象数组请求原被当空集返回200，强化共享请求解析后返回400。

最终执行：
- `pnpm db:migrate`：通过。
- `pnpm exec vitest run tests/integration/guest-discovery.test.ts`：6/6通过。
- `$env:SEARCH_CONTRACT_HOST='http://127.0.0.1:1'; pnpm test`：27文件通过、2文件跳过；230测试通过、6测试跳过，45.79秒。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过；在实施中多次运行。
- `pnpm exec next build --webpack`：通过，包含新发现动态路由。
- `PW_PORT=3127 PW_CHANNEL=chrome`，独立webpack开发服务：`pnpm exec playwright test tests/e2e/interests.spec.ts tests/e2e/pin.spec.ts tests/e2e/home.spec.ts tests/e2e/graph.spec.ts tests/e2e/visibility.spec.ts tests/e2e/browse.spec.ts tests/e2e/schools-categories.spec.ts tests/e2e/profile.spec.ts --workers 1`：27/27通过，2.6分钟。
- `git diff --check`：通过。

跳过项：Meilisearch真实契约5项（按主任务要求将SEARCH_CONTRACT_HOST指向不可达端口，最终#29串行执行）；R2真实契约1项（无专用凭据配置）。没有其他最终失败或跳过。

## 集成注意

- `term/[pageKey]/page.tsx` 原视角列表与相关词条区块移动为 `TermDiscoveryPanel`，新增/编辑入口在词条头部的 #24 改动应保留；通俗视角块、历史链接、讨论入口、信息框仍保留。
- `graph.ts` 新增不截断的发现入口，展示图谱与Agent一跳入口的现有行为未改。
- `interest-tags.ts` 唯一解析规则变更是明确拒绝JSON数组作为请求体；既有账号PUT继续使用同一解析器。
- 主任务统一执行双轴code-review；本worker未另行spawn或重复调度review。
- 未push、未评论或关闭GitHub issue。
- 3127开发服务已停止，端口无监听；数据库与隔离.env保留供复查，未提交凭据。
