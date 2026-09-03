# PhoskyWiki 技术栈（已锁定，2026-09-03）

选型输入：[REQUIREMENTS.md](../REQUIREMENTS.md)。关键外部约束：video2code 的产出形态是 React + TS + Vite + Tailwind + shadcn/ui，前端必须同生态，原型组件才能直接落入正式代码。

## 总览

| 层 | 选择 |
|---|---|
| 语言 | TypeScript（strict） |
| 框架 | Next.js（App Router）单体：页面 + API 同仓同部署 |
| UI | Tailwind CSS + shadcn/ui + Framer Motion（动效点缀） |
| 包管理 | pnpm |
| 数据库 | PostgreSQL + Drizzle ORM（drizzle-kit 迁移） |
| 搜索 | Meilisearch 派生索引，从 PG 同步（ADR-0002） |
| 认证 | better-auth：邮箱+密码、数据库会话、Drizzle 适配，不依赖第三方 OAuth |
| 内容格式 | Markdown 源文本存 PG；CodeMirror 6 编辑器 + 实时预览 + 双链自动补全；unified/remark 渲染 + 自定义 wiki-link 语法 |
| 修订 diff | jsdiff + 自定义行内/行级对比视图（任意两修订互比） |
| 图谱 | ECharts graph（词条局部 + 全站基础版）；节点超 2k 时迁移 sigma.js（WebGL），数据层 API 不变 |
| Agent BYOK | 浏览器 fetch 直连 OpenAI 兼容端点，SSE 流式输出；密钥仅存 localStorage，永不上服务器 |
| 对象存储 | Cloudflare R2（S3 API，浏览器预签名直传） |
| 部署 | Docker Compose：app + postgres + meilisearch + Caddy（自动 HTTPS）；GitHub Actions CI |
| 测试 | Vitest（单元）+ Playwright（关键路径：审核流、双链渲染、注册登录） |

## 关键决策与被否选项

1. **Next.js 单体** vs NestJS+Vite SPA vs Django+React：单体只有一个部署单元，SSR 白送 SEO（公开 wiki 的命脉），React 组件与 video2code 同构直接复用；Django admin 省后台 UI 的收益抵不过双语言维护成本。
2. **Meilisearch** vs PG zhparser：中文分词、搜索联想、分面过滤开箱即用；zhparser 相关性排序弱、扩展镜像要自己养。见 ADR-0002。
3. **Cloudflare R2** vs 自托管 MinIO：图片流量免费（wiki 图片被大量浏览不心疼）、与 Cloudflare 兜底同账号；S3 API 保证将来想去第三方化时可无缝切 MinIO。
4. **better-auth** vs Auth.js vs 自研会话：TS 原生、数据库会话、Drizzle 官方适配；不依赖任何第三方身份提供商，对海外部署的可达性最稳。
5. **Markdown 源文本** vs 富文本 JSON：任意两修订互比是审核制的硬需求，纯文本 diff 最干净；编辑体验靠预览 + 工具栏 + 双链补全补齐。

## 运行时拓扑（单 VPS）

```
浏览器 ── Caddy（自动 HTTPS）
            ├── Next.js app（standalone 容器）
            │     ├── PostgreSQL（内容 source of truth）
            │     └── Meilisearch（派生索引，事件同步 + 定期全量校对）
            ├── R2 预签名直传（图片不经过 app 服务器）
            └── OpenAI 兼容端点（浏览器直连，SSE 流式）
```
