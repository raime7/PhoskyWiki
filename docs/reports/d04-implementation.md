# D04 — 可重复交付与受控发布

对应 GitHub #38（父票 #34）。2026-09-10 实施。操作入口与安装步骤见 [发布手册](../releases.md)。

## 实施范围

CI 构建一次镜像，容器验收和完整浏览器验收使用该镜像 ID；只有 main 的全部检查通过后才推送原镜像，拉回 digest 再核对 ID，保存 SHA/run/attempt/digest 收据。手动发布入口和主机各自重新核验 GitHub 证据。PR 不取得部署凭据。Dependabot 每周覆盖 npm、Actions、Docker。

主机入口使用受限 SSH 强制命令、固定配置、跨进程锁和阶段记录；核对实际环境、数据库、图片桶、资源、旧镜像和数据库迁移历史。停写后必须完成 D03 create 与 verify，才开始迁移和健康切换。相同 schema 的不健康版本可切回旧镜像；迁移失败或不兼容则停站并保留人工恢复锁。任何路径都不自动恢复数据库。临时 GitHub token 经 SSH stdin 提供，只用于 gh 子进程环境和隔离 Docker 登录目录，用后清除。

测试保留生产认证限流，为独立浏览器上下文分配测试代理身份，并验证同一身份的连续错误密码仍触发 429。共享种子管理员和全局投票人数的旧浏览器场景串行执行；仅重置共享种子账号的测试写入预算。测试专用搜索服务限制索引内存与线程。

## 真实门禁

- main 已配置严格必需检查 `lint + typecheck + vitest`、`playwright + container`，绑定 GitHub Actions app 15368，并对管理员生效；禁止强推和删除。
- production environment 只允许 main 部署。
- 将相同必需检查应用于隔离验证分支后，无成功检查的提交实际收到 GitHub `GH006: 2 of 2 required status checks are expected` 拒绝。随后只移除隔离分支的临时保护，main 保护保留。
- 失败的 main CI run `34441238634` 被真实资格 CLI 拒绝。不存在以旧成功 attempt、可变 tag 或本地收据替代当前 run 的入口。

## 实际容器与故障演练

[完整机器记录](d04-container-drill.json) 对应 2026-09-10 08:01–08:05 UTC，使用真实 Docker、PostgreSQL、Meilisearch、D03 备份容器和专用 R2 测试桶。随机项目与 `d04/` 对象前缀已清理。

| 场景 | 观察 |
| --- | --- |
| 错环境、资源不足、缺备份配置 | 停写前拒绝，未迁移 |
| 备份命令真实失败 | 未迁移，恢复旧 app，维护 10 秒 |
| 两个发布进程并发 | 只有一个取得锁；另一进程拒绝 |
| 正常发布 | 完整备份并验证、迁移、健康切换，维护 18 秒 |
| 迁移历史倒退 | 停写前拒绝 |
| 新 app 不健康、相同 schema | 切回旧 app，维护 21 秒；HTTP 确认备份完成后新增/修改的内容仍保留 |
| 迁移中途建表后失败 | 保留实际部分迁移、停站和锁；第二次发布拒绝 |
| schema 改变且新 app 不健康 | 不自动切回，保留人工恢复锁 |

失败停站场景的 `maintenanceTargetMet=false` 是预期安全结果，不计作完成的维护窗口。隔离夹具显式恢复自己的测试数据库；生产入口没有这一动作。

Linux root 容器回归还验证连续两次发布后，备份配置仍属 UID 1000 且权限 0600，备份用户仍能读取；临时 token 不出现在输出中，Docker 登录目录已移除。该回归使用进程 stub 补充权限检查，不能替代上面的真实 Docker/R2 演练。

## 验证边界

本地容器镜像源码为隔离快照 `d1d9792ed55a0f80d7d0ee583eb6d5dd95aba680`，镜像 ID 为 `sha256:3b919aaba5220fcce20b383120317e8888425254de279c0ab45e6af5b03f4c9b`；发布驱动和测试夹具为最终工作区版本，因此记录明确标记 `dirty=true`。这证明操作行为，不是最终 main SHA 的交付资格。最终可发布产物必须以 main CI 收据为准。

本地 lint、typecheck 和 13 个资格边界测试通过。独立数据库全量 Vitest：41 文件通过、2 文件跳过，285 用例通过、6 跳过；缺少专用凭据的供应商契约不算通过，R2 发布契约另以上述真实演练覆盖。干净数据库和专用搜索服务上的完整浏览器套件：85 项通过、1 项条件跳过，3.5 分钟，禁用重试。两位独立审查者分别复查工程标准和 D04 规格，修复配置所有权与迁移倒退问题后均无剩余发现。

生产升级、真实公网/搜索维护验收和 1 vCPU / 2 GB 容量观察由 D06/D07 后续使用合格 main 产物执行；本报告不将本地资源峰值当作生产容量证明。

## main 产物与生产预检兼容修复

main `e52832c5609a70e89043b555e2a695f39a15f195` 的 [CI 34455454444](https://github.com/raime7/PhoskyWiki/actions/runs/34455454444) 三项作业成功，真实资格 CLI 已接受 attempt 1 收据：manifest digest `sha256:7277ea092bc3d44f4c30737da8e0acc6ae8562898ba06cc0fbdb866b860d7318`，config digest `sha256:c4fd8a003047261837706ab16d5ccb480efaac1dbf0d8a9bcc81f4527454501c`。云端 292 个单元/集成、10 个运维、13 个发布资格用例通过。

D06 随后执行真实受控发布，两次均在停写前拒绝：run 34456551202 暴露旧 runtime 缺少已约定的 PHOSKYWIKI_ENV，部署任务同步补齐 runtime/备份副本；run 34456712050 暴露 Docker 29 containerd 的 `.Id` 返回 manifest digest，与经典 CI 存储返回 config digest 不同。主机只读 ctr 检查确认实际 manifest 内 config digest 与收据完全相同，旧应用保持健康。

后续发布入口补齐上述存储兼容验证，仍要求固定 manifest、本地 Descriptor、准确 config digest 和源码标签全部一致。新增 9 个边界回归，与原 13 项资格测试一起通过；lint/typecheck 通过，独立工程审查无剩余发现。该修复只改变主机资格验证，不改变已测试应用镜像或数据库迁移。
