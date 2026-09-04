// CLI 入口：pnpm db:seed —— 清空并重灌演示内容 + upsert 管理员（开发/CI 用，勿在生产跑）。
import "dotenv/config";

import { seedDatabase } from "../src/db/seed";
import { seedAdminAccount } from "../src/db/seed-admin";

async function main() {
  const summary = await seedDatabase();
  console.log(
    `种子已灌入：词条 ${summary.terms}、消歧义页 ${summary.disambiguations}、` +
      `诠释者 ${summary.interpreters}、学派 ${summary.schools}、` +
      `分类 ${summary.categories}、视角 ${summary.perspectives}、` +
      `双链 ${summary.links.resolved} 条已解析 / ${summary.links.red} 条红链。`,
  );

  const admin = await seedAdminAccount();
  const state = admin.created ? "已创建" : "已更新";
  if (admin.passwordGenerated) {
    console.log(`管理员账号 ${state}：${admin.email}，本次随机密码：${admin.password}`);
  } else {
    console.log(`管理员账号 ${state}：${admin.email}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
