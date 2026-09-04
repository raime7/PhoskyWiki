// CLI 入口：pnpm db:seed —— 清空并重灌演示内容（开发/CI 用，勿在生产跑）。
import "dotenv/config";

import { seedDatabase } from "../src/db/seed";

async function main() {
  const summary = await seedDatabase();
  console.log(
    `种子已灌入：词条 ${summary.terms}、消歧义页 ${summary.disambiguations}、` +
      `诠释者 ${summary.interpreters}、视角 ${summary.perspectives}、` +
      `双链 ${summary.links.resolved} 条已解析 / ${summary.links.red} 条红链。`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
