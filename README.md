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

# 4. 启动应用
pnpm dev            # http://localhost:3000
```

## 测试

```bash
pnpm test           # Vitest：单元 + 集成（集成测试连真实 PG，需先 docker compose up）
pnpm test:e2e       # Playwright：真实浏览器（自动起 dev server，已有则复用）
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
