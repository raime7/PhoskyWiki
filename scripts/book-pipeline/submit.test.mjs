// 缝 2：submit（#112）——只测试运行行为：两阶段顺序、编辑带 base、说明含报告摘要且不超限、账本使重跑不重复。
// 审稿与校验报告是手写样例（按 types.ts 契约），不调用模型、网络或数据库。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const cli = join(root, "scripts/book-pipeline/cli.ts");
const fixtures = join(root, "scripts/book-pipeline/fixtures");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const NOTE_MAX = 20000;

function pipeline(...args) {
  return spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", cli, ...args], { cwd: root, encoding: "utf8" });
}
function ok(...args) {
  const run = pipeline(...args);
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim().split("\n").map((line) => JSON.parse(line));
}
function refused(code, ...args) {
  const run = pipeline(...args);
  assert.equal(run.status, 1, run.stdout);
  assert.match(run.stderr, new RegExp(`^${code}: `));
}

const report = (wd, key, over = {}) => {
  const hash = sha256(readFileSync(join(wd, "perspectives", key, "perspective.md")));
  writeFileSync(
    join(wd, "perspectives", key, "review.json"),
    JSON.stringify({
      schema: "phosky.book-pipeline/review@1", conceptKey: key, perspectiveSha256: hash, reviewer: "审稿子代理",
      summary: "摘录均支持相应论点，未见越界。",
      issues: [{ claimId: null, kind: "other", severity: "note", message: "措辞可再精炼。", excerpt: null }],
      ...over.review,
    }, null, 2),
  );
  writeFileSync(
    join(wd, "perspectives", key, "validation.json"),
    JSON.stringify({
      schema: "phosky.book-pipeline/validation@1", conceptKey: key, perspectiveSha256: hash, ok: true, findings: [], overridden: [],
      ...over.validation,
    }, null, 2),
  );
};

function withWorkdir(fn) {
  const wd = mkdtempSync(join(tmpdir(), "book-pipeline-submit-"));
  try {
    ok("freeze", join(fixtures, "sample-book.epub"), "--workdir", wd, "--id", "sample", "--author", "范例思",
      "--title", "论尺度", "--translator", "某译者", "--edition", "示例出版社，2026", "--from", "A．质", "--to", "§ 2");
    ok("freeze", join(fixtures, "sample-book.md"), "--workdir", wd, "--id", "sample-md", "--author", "范例思", "--title", "论开端", "--translator", "另一译者");
    mkdirSync(join(wd, "candidates"));
    cpSync(join(fixtures, "assemble", "candidates.json"), join(wd, "candidates", "candidates.json"));
    for (const key of ["kaiduan", "cunzai"]) {
      mkdirSync(join(wd, "perspectives", key), { recursive: true });
      cpSync(join(fixtures, "assemble", `claim-map.${key}.json`), join(wd, "perspectives", key, "claim-map.json"));
    }
    writeFileSync(
      join(wd, "candidates", "confirmation.json"),
      JSON.stringify({ schema: "phosky.book-pipeline/confirmation@1", candidateListSha256: sha256(readFileSync(join(wd, "candidates", "candidates.json"))), confirmedBy: "站长", confirmedAt: "2026-10-08T00:00:00.000Z", confirmed: ["kaiduan", "cunzai"] }),
    );
    ok("assemble", "--workdir", wd, "--key", "kaiduan", "--rewrite", "cunzai");
    report(wd, "kaiduan");
    report(wd, "cunzai");
    return fn(wd);
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
}

const dry = (wd, ...extra) => ok("submit", "--workdir", wd, ...extra);
const requests = (lines) => lines.filter((l) => l.state === "send");

test("dry run lists phase 1 (interpreter, term) before phase 2 and an edit carries the head base revision", () =>
  withWorkdir((wd) => {
    const lines = dry(wd);
    const sent = requests(lines);
    assert.deepEqual(sent.map((r) => [r.opKey, r.phase, r.kind]), [
      ["new_interpreter:范例思", "entities", "new_interpreter"],
      ["new_term:kaiduan", "entities", "new_term"],
      ["perspective:kaiduan", "perspectives", "new_perspective"],
      ["perspective:cunzai", "perspectives", "edit"],
    ]);
    // 新视角依赖第一阶段；编辑目标已在站上，只需 base 修订
    assert.deepEqual(sent[2].dependsOn, ["new_term:kaiduan", "new_interpreter:范例思"]);
    assert.deepEqual(sent[3].dependsOn, []);
    assert.equal(sent[3].request.pageId, 42);
    assert.equal(sent[3].request.baseRevisionId, 7);
    assert.equal(sent[3].request.content, readFileSync(join(wd, "perspectives", "cunzai", "perspective.md"), "utf8"));
    assert.equal(sent[1].request.title, "开端");
    assert.deepEqual(sent[1].request.aliases, ["起点"]);
    // 新词条的简介取会话给出的中性词条简介，不是诠释者视角的一句话核心
    assert.equal(sent[1].request.summary, "开端：思维或体系由以出发的起点。");
    assert.equal(json(join(wd, "submit", "plan.json")).requests.length, 4);
    assert.equal(lines.at(-1).mode, "dry-run");
    assert.equal(existsSync(join(wd, "submit", "ledger.jsonl")), false, "dry run never touches the ledger");
  }));

test("an edit uses base.json head when present and refuses a draft built on another revision", () =>
  withWorkdir((wd) => {
    const base = (revisionId) =>
      writeFileSync(join(wd, "perspectives", "cunzai", "base.json"), JSON.stringify({ schema: "phosky.book-pipeline/incremental-base@1", pageId: 42, head: { revisionId, content: "x" }, lastAi: null }));
    base(7);
    assert.equal(requests(dry(wd)).find((r) => r.opKey === "perspective:cunzai").request.baseRevisionId, 7);
    // head 已前进而稿子未重并：以新 base 提交旧稿会覆盖期间的人工改动（#111 的正向路径见 incremental.test.mjs）
    base(11);
    refused("SUBMIT_STALE", "submit", "--workdir", wd);
  }));

test("the note carries the review and validation summary and stays within the site limit", () =>
  withWorkdir((wd) => {
    const note = requests(dry(wd)).find((r) => r.opKey === "perspective:kaiduan").request.note;
    assert.match(note, /审稿子代理/);
    assert.match(note, /摘录均支持相应论点/);
    assert.match(note, /措辞可再精炼/);
    assert.match(note, /校验.*通过/);
    // 超长审稿问题：说明被截断而不超限
    const issues = Array.from({ length: 200 }, (_, i) => ({ claimId: "k1", kind: "other", severity: "warning", message: `问题${i}：` + "长".repeat(1000), excerpt: null }));
    report(wd, "kaiduan", { review: { issues } });
    const long = requests(dry(wd)).find((r) => r.opKey === "perspective:kaiduan").request.note;
    assert.ok(long.length <= NOTE_MAX && long.length > 5000, String(long.length));
    assert.match(long, /已截断/);
  }));

test("a perspective with unresolved validation failures is refused (limits need an override), as are stale or blocked reports", () =>
  withWorkdir((wd) => {
    const finding = { rule: "limit.claims", severity: "limit", message: "论点过多", claimId: null };
    report(wd, "kaiduan", { validation: { ok: false, findings: [finding] } });
    refused("VALIDATION_FAILED", "submit", "--workdir", wd);
    // 人工放行 limit 后通过；error 永不放行
    const override = { rule: "limit.claims", claimId: null, reason: "论点确有这么多", approvedBy: "站长" };
    report(wd, "kaiduan", { validation: { ok: true, findings: [finding], overridden: [override] } });
    assert.equal(requests(dry(wd)).length, 4);
    report(wd, "kaiduan", { validation: { ok: true, findings: [{ ...finding, rule: "quotation", severity: "error" }], overridden: [{ ...override, rule: "quotation" }] } });
    refused("VALIDATION_FAILED", "submit", "--workdir", wd);
    report(wd, "kaiduan", { validation: { perspectiveSha256: "0".repeat(64) } });
    refused("VALIDATION_STALE", "submit", "--workdir", wd);
    report(wd, "kaiduan", { review: { perspectiveSha256: "0".repeat(64) } });
    refused("REVIEW_STALE", "submit", "--workdir", wd);
    report(wd, "kaiduan", { review: { issues: [{ claimId: "k1", kind: "overreach", severity: "blocker", message: "越界", excerpt: null }] } });
    refused("REVIEW_BLOCKERS", "submit", "--workdir", wd);
    rmSync(join(wd, "perspectives", "kaiduan", "validation.json"));
    refused("VALIDATION_MISSING", "submit", "--workdir", wd);
  }));

test("the ledger keeps reruns from repeating requests; unknown outcomes block and changed content needs --resubmit", () =>
  withWorkdir((wd) => {
    const ledger = join(wd, "submit", "ledger.jsonl");
    mkdirSync(join(wd, "submit"));
    const entry = (opKey, event, extra = {}) =>
      JSON.stringify({ at: "2026-10-08T00:00:00.000Z", opKey, event, contentSha256: null, httpStatus: 201, submissionId: null, pageId: null, message: null, ...extra }) + "\n";
    const editSha = sha256(readFileSync(join(wd, "perspectives", "cunzai", "perspective.md")));
    appendFileSync(ledger, entry("new_interpreter:范例思", "submitted", { submissionId: 5 }));
    appendFileSync(ledger, entry("perspective:cunzai", "submitted", { contentSha256: editSha, submissionId: 6 }));
    const lines = dry(wd);
    assert.deepEqual(requests(lines).map((r) => r.opKey), ["new_term:kaiduan", "perspective:kaiduan"]);
    assert.deepEqual(lines.filter((l) => l.state === "skip-in-ledger").map((l) => l.opKey), ["new_interpreter:范例思", "perspective:cunzai"]);
    assert.deepEqual(dry(wd), lines, "same ledger, same listing");

    // 受理后记账（带页面 ID）：占位被真实 ID 取代，第一阶段请求不再出现
    ok("submit", "--workdir", wd, "--reconcile", "new_interpreter:范例思=900", "--reconcile", "new_term:kaiduan=901");
    const after = dry(wd);
    assert.deepEqual(requests(after).map((r) => r.opKey), ["perspective:kaiduan"]);
    assert.deepEqual(requests(after)[0].dependsOn, []);
    assert.equal(requests(after)[0].request.termId, 901);
    assert.equal(requests(after)[0].request.interpreterId, 900);

    // 悬空 intent = 结果未知：列为 blocked，--send 拒绝（在联网之前）
    appendFileSync(ledger, entry("perspective:kaiduan", "intent", { httpStatus: null }));
    const blocked = dry(wd);
    assert.deepEqual(blocked.filter((l) => l.state === "blocked-unknown-outcome").map((l) => l.opKey), ["perspective:kaiduan"]);
    assert.equal(requests(blocked).length, 0);
    refused("LEDGER_AMBIGUOUS", "submit", "--workdir", wd, "--send");

    // 已提交的内容后来变了：拒绝，除非显式 --resubmit
    appendFileSync(ledger, entry("perspective:cunzai", "submitted", { contentSha256: "1".repeat(64) }));
    refused("LEDGER_CONTENT_CHANGED", "submit", "--workdir", wd);
    assert.ok(requests(dry(wd, "--resubmit", "perspective:cunzai")).some((r) => r.opKey === "perspective:cunzai"));
  }));

test("an unconfirmed candidate list is refused", () =>
  withWorkdir((wd) => {
    rmSync(join(wd, "candidates", "confirmation.json"));
    refused("UNCONFIRMED", "submit", "--workdir", wd);
  }));
