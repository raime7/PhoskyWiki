# PhoskyWiki

左翼哲学 / 政治经济学 / 历史领域的原子笔记 WIKI：每个词条聚合多个诠释者的视角。

- 领域术语与语言规范：[CONTEXT.md](CONTEXT.md)
- 需求与一期 MVP spec：[REQUIREMENTS.md](REQUIREMENTS.md) · [docs/specs/0001-mvp.md](docs/specs/0001-mvp.md)
- 技术选型与决策记录：[docs/TECH-STACK.md](docs/TECH-STACK.md) · [docs/adr/](docs/adr/)

## 本地开发

```bash
# 1. 起依赖服务（PostgreSQL + Meilisearch）
docker compose up -d

# 2. 准备环境变量（首次）
cp .env.example .env

# 3. 安装依赖并应用数据库迁移
pnpm install
pnpm db:migrate

# 4. 灌入演示内容（词条 / 诠释者 / 视角种子，幂等重灌）
pnpm db:seed

# 5. 启动应用
pnpm dev            # http://localhost:3000
```

## 测试

```bash
pnpm test           # Vitest：单元 + 集成（集成测试连真实 PG，需先 docker compose up；内容集成测试自灌种子）
pnpm test:e2e       # Playwright：真实浏览器（自动起 dev server，已有则复用；依赖 pnpm db:seed 的演示内容）
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
```

Playwright 默认下载自带 Chromium；本地若已装 Chrome/Edge，可用系统浏览器跑，跳过下载：

```bash
PW_CHANNEL=chrome pnpm test:e2e
```

CI（GitHub Actions）在每次 push 时跑 lint + typecheck + Vitest + Playwright，全绿才合入。

## 探活

`GET /healthz` 返回 PG 连接状态：`{"status":"ok","checks":{"postgres":"up"}}`（PG 不可达时 `503` + `postgres: "down"`）。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `pnpm db:generate` | 从 `src/db/schema.ts` 生成迁移（drizzle-kit） |
| `pnpm db:migrate` | 应用 `drizzle/` 下的迁移到数据库 |
| `pnpm db:seed` | 清空内容表并重灌演示内容（开发/CI 用，勿在生产跑） |

## 读路径（T02）

游客即可完整浏览，无需登录：

- 词条页 `/<term>/<slug>-<id>`：编委会通俗视角全文置顶，其余视角列表默认露 5 条、可展开全部，右侧信息框；
- 视角页 `/<perspective>/<slug>-<id>`：Markdown 渲染，正文 `[[词条]]` 双链落词条枢纽，未创建词条渲染为红链（不可点击的缺口标记）；
- 诠释者页 `/<interpreter>/<slug>-<id>`：信息框（生卒年等）+ 全部视角索引；
- URL 只认尾随 id：`/<type>/<id>` 与旧 slug 访问都会 307 到规范路径 `/term/主体性-1`，页面改名不断链。
