import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("备份命令在连接前拒绝不匹配的数据库目标，且不输出密码", () => {
  const directory = mkdtempSync(join(tmpdir(), "phosky-backup-test-"));
  const config = join(directory, "config.json");
  try {
    writeFileSync(config, JSON.stringify({ databaseUrl: "postgres://phosky:never-print-this@127.0.0.1:1/wiki_test" }), { mode: 0o600 });
    const result = spawnSync(process.execPath, ["scripts/backup.mjs", "create", "--config", config, "--target", "production:5432/wiki/phosky"], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("TARGET_MISMATCH");
    expect(result.stderr).not.toContain("never-print-this");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
