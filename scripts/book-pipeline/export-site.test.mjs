// 缝 2：export-site——把站点公开只读接口的载荷整理成 site-terms.json 与 base.json。
// 不连网络：纯函数用夹具（fixtures/export-site/ 与 incremental 的 head / 上一次 AI 修订）测试，
// 命令本身注入假的 fetch；再用导出的 base.json 走一遍 incremental，确认两者衔接。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const cli = join(root, "scripts/book-pipeline/cli.ts");
const exportModule = join(root, "scripts/book-pipeline/export-site.ts");
const fixtures = join(root, "scripts/book-pipeline/fixtures");
const TSX = ["--conditions=react-server", "--import", "tsx"];
const ORIGIN = "https://wiki.example.test";
const AI = "user-ai-editor";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const text = (path) => readFileSync(path, "utf8");

const catalog = json(join(fixtures, "export-site", "site-catalog.json"));
/** /api/pages/42/history 的载荷形状（修订按 createdAt 倒序，字段与站点一致）；正文取 incremental 夹具 */
const history = {
  page: { id: 42, type: "perspective", title: "范例思论存在", slug: "fanlisi-cunzai", deletedAt: null },
  revisions: [
    { id: 9, pageId: 42, content: text(join(fixtures, "incremental", "head.cunzai.md")), snapshot: null, source: "approval", createdBy: "user-human", rollbackFromId: null, createdAt: "2026-10-02T00:00:00.000Z" },
    { id: 7, pageId: 42, content: text(join(fixtures, "incremental", "last-ai.cunzai.md")), snapshot: null, source: "approval", createdBy: AI, rollbackFromId: null, createdAt: "2026-10-01T00:00:00.000Z" },
    { id: 3, pageId: 42, content: "最早的人工稿。\n", snapshot: null, source: "create", createdBy: AI, rollbackFromId: null, createdAt: "2026-09-01T00:00:00.000Z" },
  ],
  comparison: null,
};

function pipeline(...args) {
  return spawnSync(process.execPath, [...TSX, cli, ...args], { cwd: root, encoding: "utf8" });
}
function ok(...args) {
  const run = pipeline(...args);
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim().split("\n").map((line) => JSON.parse(line));
}

/** 在子进程里调用 export-site.ts，把 body 的结果（或 `CODE: …` 错误）以 JSON 带回。 */
function call(body, input) {
  const run = spawnSync(
    process.execPath,
    [...TSX, "--input-type=module", "-e",
      `import * as m from ${JSON.stringify(exportModule)};
       const input = JSON.parse(process.argv[1]);
       try { console.log(JSON.stringify({ ok: await (async () => { ${body} })() })); }
       catch (e) { console.log(JSON.stringify({ error: e.message })); }`, JSON.stringify(input)],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("the site catalog becomes a deterministic site-terms.json; malformed payloads are refused", () => {
  const { ok: site } = call(`return m.siteExportFromCatalog(input, { origin: "${ORIGIN}", exportedAt: "2026-10-08T00:00:00.000Z" });`, catalog);
  assert.deepEqual(site, {
    schema: "phosky.book-pipeline/site-export@2",
    exportedAt: "2026-10-08T00:00:00.000Z",
    origin: ORIGIN,
    terms: [
      { pageId: 10, title: "尺度", slug: "chidu", aliases: [], deleted: false },
      { pageId: 41, title: "存在", slug: "cunzai", aliases: ["Sein"], deleted: false },
    ],
    interpreters: [{ pageId: 20, title: "范例思", slug: "fanlisi", deleted: false }],
    perspectives: [
      { pageId: 30, termId: 10, interpreterId: 20, headRevisionId: 300, deleted: false },
      { pageId: 42, termId: 41, interpreterId: 20, headRevisionId: 9, deleted: false },
    ],
    // 游客响应没有该字段：未做已删除词条的同名检查
    deletedTermTitles: null,
  });
  // 登录后的响应带已删除词条的标题（去重、排序）
  const { ok: withDeleted } = call(`return m.siteExportFromCatalog(input, { origin: "x", exportedAt: "y" }).deletedTermTitles;`, { ...catalog, deletedTermTitles: ["乙", "甲", "乙"] });
  assert.deepEqual(withDeleted, ["乙", "甲"].sort());
  assert.match(call(`return m.siteExportFromCatalog(input, { origin: "x", exportedAt: "y" });`, { ...catalog, deletedTermTitles: "甲" }).error, /^EXPORT_SITE_PAYLOAD: .*deletedTermTitles/);
  const refuse =(payload) => assert.match(call(`return m.siteExportFromCatalog(input, { origin: "x", exportedAt: "y" });`, payload).error, /^EXPORT_SITE_PAYLOAD: /);
  refuse({ ...catalog, terms: undefined });
  refuse({ ...catalog, terms: [{ ...catalog.terms[0], aliases: "Sein" }] });
  refuse({ ...catalog, perspectives: [{ ...catalog.perspectives[0], headRevisionId: null }] });
  refuse([]);
});

test("export-site warns when the deleted-term check is skipped (no credentials) and not when the site returned deletedTermTitles", () => {
  const wd = mkdtempSync(join(tmpdir(), "book-pipeline-export-warn-"));
  try {
    const run = (payload) => call(
      `const warnings = [];
       await m.exportSite({ workdir: ${JSON.stringify(wd)}, origin: "${ORIGIN}", env: {}, fetch: async () => input, warn: (w) => warnings.push(w) });
       return warnings;`,
      payload,
    );
    const warnings = run(catalog).ok;
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^WARN: .*BOOK_PIPELINE_EMAIL.*skipped/);
    assert.equal(json(join(wd, "candidates", "site-terms.json")).deletedTermTitles, null);
    assert.deepEqual(run({ ...catalog, deletedTermTitles: ["规定性"] }).ok, []);
    assert.deepEqual(json(join(wd, "candidates", "site-terms.json")).deletedTermTitles, ["规定性"]);
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
});

test("a perspective's history becomes base.json: head = highest revision id, last AI = the AI account's latest", () => {
  const base = (payload, aiUser = AI, pageId = 42) => call(`return m.incrementalBaseFromHistory(input, ${JSON.stringify({ pageId, aiUser })});`, payload);
  const { ok: exported } = base(history);
  assert.deepEqual([exported.schema, exported.pageId, exported.head.revisionId, exported.lastAi.revisionId], ["phosky.book-pipeline/incremental-base@1", 42, 9, 7]);
  assert.equal(exported.head.content, history.revisions[0].content);
  assert.equal(exported.lastAi.content, history.revisions[1].content);
  // 修订顺序不影响结果；AI 账号从未编辑 → lastAi 为 null
  assert.deepEqual(base({ ...history, revisions: [...history.revisions].reverse() }).ok, exported);
  assert.equal(base(history, "someone-else").ok.lastAi, null);
  // 页面不符、不是视角、没有修订：拒绝
  assert.match(base(history, AI, 43).error, /^EXPORT_SITE_PAYLOAD: .*another page/);
  assert.match(base({ ...history, page: { ...history.page, type: "term" } }).error, /not a perspective/);
  assert.match(base({ ...history, revisions: [] }).error, /no revisions/);
});

test("export-site writes site-terms.json and base.json through injected reads, and incremental picks base.json up", () => {
  const wd = mkdtempSync(join(tmpdir(), "book-pipeline-export-"));
  try {
    const run = (options) => call(
      `const pages = { "${ORIGIN}/api/site-catalog": input.catalog, "${ORIGIN}/api/pages/42/history": input.history };
       const seen = [];
       const result = await m.exportSite({ ...input.options, fetch: async (url) => { seen.push(url); if (!(url in pages)) throw new Error("EXPORT_SITE_HTTP: 404 " + url); return pages[url]; }, now: new Date("2026-10-08T00:00:00.000Z") });
       return { result, seen };`,
      { catalog, history, options: { workdir: wd, ...options } },
    );

    const site = run({ origin: ORIGIN + "/" });
    assert.deepEqual(site.ok.seen, [`${ORIGIN}/api/site-catalog`]);
    assert.deepEqual(site.ok.result, [{ file: "site-terms.json", status: "written", terms: 2, interpreters: 1, perspectives: 2 }]);
    assert.equal(json(join(wd, "candidates", "site-terms.json")).origin, ORIGIN);

    // 视角导出依赖候选清单里的已有视角；先准备工作目录（与 incremental.test.mjs 相同）
    assert.match(run({ origin: ORIGIN, keys: ["cunzai"], aiUser: AI }).error, /^MISSING_INPUT: /);
    ok("freeze", join(fixtures, "sample-book.md"), "--workdir", wd, "--id", "sample-md", "--author", "范例思", "--title", "论开端", "--translator", "另一译者");
    ok("freeze", join(fixtures, "sample-book.epub"), "--workdir", wd, "--id", "sample", "--author", "范例思",
      "--title", "论尺度", "--translator", "某译者", "--edition", "示例出版社，2026", "--from", "A．质", "--to", "§ 2");
    cpSync(join(fixtures, "assemble", "candidates.json"), join(wd, "candidates", "candidates.json"));
    writeFileSync(
      join(wd, "candidates", "confirmation.json"),
      JSON.stringify({ schema: "phosky.book-pipeline/confirmation@1", candidateListSha256: sha256(readFileSync(join(wd, "candidates", "candidates.json"))), confirmedBy: "站长", confirmedAt: "2026-10-08T00:00:00.000Z", confirmed: ["kaiduan", "cunzai"] }),
    );
    assert.match(run({ origin: ORIGIN, keys: ["kaiduan"], aiUser: AI }).error, /^EXPORT_SITE_NO_PERSPECTIVE: /);
    assert.match(run({ origin: ORIGIN, keys: ["cunzai", "nope"], aiUser: AI }).error, /^EXPORT_SITE_UNKNOWN_KEY: /);
    assert.equal(existsSync(join(wd, "perspectives", "cunzai", "base.json")), false, "nothing is written when one key fails");

    const exported = run({ origin: ORIGIN, keys: ["cunzai"], aiUser: AI });
    assert.deepEqual(exported.ok.seen, [`${ORIGIN}/api/pages/42/history`]);
    assert.deepEqual(exported.ok.result, [
      { file: "base.json", key: "cunzai", status: "written", pageId: 42, headRevisionId: 9, lastAiRevisionId: 7, headMovedSinceCandidates: true },
    ]);
    assert.equal(run({ origin: ORIGIN, keys: ["cunzai"], aiUser: AI }).ok.result[0].status, "unchanged");

    // incremental 省略 --head 即沿用导出的 base.json
    const line = ok("incremental", "--workdir", wd, "--key", "cunzai")[0];
    assert.deepEqual([line.stage, line.baseRevisionId, line.lastAiRevisionId, line.locked], ["awaiting-claim-map", 9, 7, 1]);
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
});

test("export-site needs --origin, and --ai-user exactly with --key", () => {
  const usage = (...args) => assert.equal(pipeline("export-site", "--workdir", "/nonexistent", ...args).status, 2, args.join(" "));
  usage();
  usage("--origin", ORIGIN, "--key", "cunzai");
  usage("--origin", ORIGIN, "--ai-user", AI);
  const bad = pipeline("export-site", "--workdir", "/nonexistent", "--origin", "wiki.example.test");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^EXPORT_SITE_ORIGIN: /);
});
