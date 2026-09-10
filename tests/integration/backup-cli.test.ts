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

it.each([undefined, null, [], {}, "never-print-this"].map(runtime => ({ runtime })))("备份命令拒绝缺失或无效的恢复配置（$runtime）", ({ runtime }) => {
  const directory = mkdtempSync(join(tmpdir(), "phosky-backup-test-"));
  const config = join(directory, "config.json");
  try {
    writeFileSync(config, JSON.stringify({
      databaseUrl: "postgres://phosky:never-print-this@127.0.0.1:1/wiki_test",
      source: { bucket: "images-test" },
      backup: { bucket: "backups-test", prefix: "points/" },
      runtime,
    }), { mode: 0o600 });
    const result = spawnSync(process.execPath, ["scripts/backup.mjs", "create", "--config", config,
      "--target", "127.0.0.1:1/wiki_test/phosky", "--bucket", "backups-test"],
    { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("RUNTIME_CONFIG_REQUIRED");
    expect(result.stdout).toBe("");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
