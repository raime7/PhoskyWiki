// CLI 入口：pnpm search:reindex —— 全量校对搜索索引（ADR-0002 定期兜底）。
// 供 cron/定时任务直接调用：读 PG 重建全部文档、清空重灌索引，修复任何漂移；
// 与受理管线的增量同步互补。需要 MEILI_HOST 指向可用的 Meilisearch。
import "dotenv/config";

import { reindexAll } from "../src/lib/search/search-sync";

async function main() {
  const { indexed } = await reindexAll();
  console.log(`搜索索引已全量重建：${indexed} 篇文档。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
