// 缝 2：incremental（#111）——只测试运行行为：无新材料涉及的论点逐字不变；锁定段落不变；新摘录带书目标注；
// 产出的编辑稿以 head 为 base，validate 与 submit（试运行）照常通过。
// 夹具：fixtures/incremental/ 下手写的 head 与上一次 AI 修订（导出的 Markdown）及增量论点映射；不调用模型、网络或数据库。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const cli = join(root, "scripts/book-pipeline/cli.ts");
const fixtures = join(root, "scripts/book-pipeline/fixtures");
const HEAD = join(fixtures, "incremental", "head.cunzai.md");
const LAST_AI = join(fixtures, "incremental", "last-ai.cunzai.md");
const CLAIM_MAP = join(fixtures, "incremental", "claim-map.cunzai.json");
const LOCKED = "范例思提醒，这里的存在不能按经验事物来理解：它不是被感知的对象，而是思维自身的规定。";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const text = (path) => readFileSync(path, "utf8");

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
  return run.stderr;
}

function withWorkdir(fn) {
  const wd = mkdtempSync(join(tmpdir(), "book-pipeline-incremental-"));
  try {
    // 旧书（head 引用的《论开端》）与新书《论尺度》冻结在同一工作目录
    ok("freeze", join(fixtures, "sample-book.md"), "--workdir", wd, "--id", "sample-md", "--author", "范例思", "--title", "论开端", "--translator", "另一译者");
    ok("freeze", join(fixtures, "sample-book.epub"), "--workdir", wd, "--id", "sample", "--author", "范例思",
      "--title", "论尺度", "--translator", "某译者", "--edition", "示例出版社，2026", "--from", "A．质", "--to", "§ 2");
    mkdirSync(join(wd, "candidates"));
    cpSync(join(fixtures, "assemble", "candidates.json"), join(wd, "candidates", "candidates.json"));
    cpSync(join(fixtures, "validate", "site-terms.json"), join(wd, "candidates", "site-terms.json"));
    writeFileSync(
      join(wd, "candidates", "confirmation.json"),
      JSON.stringify({ schema: "phosky.book-pipeline/confirmation@1", candidateListSha256: sha256(readFileSync(join(wd, "candidates", "candidates.json"))), confirmedBy: "站长", confirmedAt: "2026-10-08T00:00:00.000Z", confirmed: ["kaiduan", "cunzai"] }),
    );
    return fn(wd, (name) => join(wd, "perspectives", "cunzai", name));
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
}

const importHead = (wd, ...extra) =>
  ok("incremental", "--workdir", wd, "--key", "cunzai", "--head", HEAD, "--head-revision", "9", "--last-ai", LAST_AI, "--last-ai-revision", "7", ...extra)[0];
const merge = (wd) => ok("incremental", "--workdir", wd, "--key", "cunzai")[0];
/** 正文（分隔线之前）的顶层块；模板中块与块之间恰好一个空行 */
const bodyBlocks = (md) => md.slice(0, md.indexOf("\n---\n")).trim().split("\n\n");

test("importing the head writes base.json, locks only human-edited body blocks, and offers a scaffold", () =>
  withWorkdir((wd, file) => {
    const line = importHead(wd);
    assert.deepEqual(
      [line.status, line.stage, line.pageId, line.baseRevisionId, line.lastAiRevisionId, line.locked, line.footerHumanEdits],
      ["written", "awaiting-claim-map", 42, 9, 7, 1, 0],
    );
    assert.deepEqual(line.scaffold.claims.map((c) => [c.heading, c.revision, c.exposition, c.excerpts]), [
      ["存在是直接的规定性", "kept", "", []],
      ["存在不是经验事物", "kept", "", []],
    ]);
    assert.equal(line.scaffold.core, "范例思以存在为直接的规定性，并区分了存在与经验事物。");

    const base = json(file("base.json"));
    assert.deepEqual([base.schema, base.pageId, base.head.revisionId, base.lastAi.revisionId], ["phosky.book-pipeline/incremental-base@1", 42, 9, 7]);
    assert.equal(base.head.content, text(HEAD));
    const locks = json(file("locks.json"));
    assert.deepEqual(locks.blocks, [{ index: 5, sha256: sha256(LOCKED), text: LOCKED, reason: "human-edit" }]);
    assert.deepEqual([locks.headRevisionId, locks.lastAiRevisionId], [9, 7]);
    assert.equal(existsSync(file("perspective.md")), false, "no draft until the session writes claim-map.json");
    assert.equal(importHead(wd).status, "unchanged");

    // 从无 AI 修订：正文全部锁定（资料说明由程序推导，不锁）
    const all = ok("incremental", "--workdir", wd, "--key", "cunzai", "--head", HEAD, "--head-revision", "9", "--no-last-ai")[0];
    assert.equal(all.locked, bodyBlocks(text(HEAD)).length);
    assert.equal(json(file("locks.json")).lastAiRevisionId, null);
  }));

test("merging keeps untouched claims byte-identical and locked blocks unchanged; new excerpts carry their book; validate and submit accept the draft", () =>
  withWorkdir((wd, file) => {
    importHead(wd);
    cpSync(CLAIM_MAP, file("claim-map.json"));
    const line = merge(wd);
    assert.deepEqual([line.stage, line.baseRevisionId, line.claims, line.newExcerpts], ["merged", 9, { kept: 1, extended: 1, new: 1 }, 2]);
    const head = text(HEAD);
    const md = text(file("perspective.md"));

    // 无新材料涉及的论点（k1）连同核心逐字不变，且仍紧接着 k2
    const k1 = head.slice(head.indexOf("## 存在是直接的规定性"), head.indexOf("## 存在不是经验事物"));
    assert.ok(md.startsWith(head.slice(0, head.indexOf("## 存在不是经验事物"))));
    assert.ok(md.includes(k1 + "## 存在不是经验事物\n\n" + LOCKED + "\n\n"));
    // 既有正文块全部原样保留且顺序不变；新增的只有 k2 的一段解读与一段摘录、k3 整节（标题、解读、摘录）
    const before = bodyBlocks(head);
    const after = bodyBlocks(md);
    let at = 0;
    for (const block of before) {
      at = after.indexOf(block, at);
      assert.ok(at >= 0, `existing block changed: ${block}`);
      at++;
    }
    assert.equal(after.length, before.length + 5);
    // 锁定块原样在稿中
    assert.ok(after.includes(json(file("locks.json")).blocks[0].text));

    // 新摘录的出处行标注所出书目；既有摘录的出处不变
    const assembled = json(file("assembled.json"));
    assert.deepEqual([assembled.mode, assembled.baseRevisionId, assembled.markdownSha256], ["edit", 9, sha256(md)]);
    assert.deepEqual(assembled.excerpts.map((e) => [e.claimId, e.ref.paragraph, e.ref.from, e.ref.to, e.citation]), [
      ["k1", "sample-md:t.p1", 1, 2, "《论开端》，§1，正文，另一译者译"],
      ["k2", "sample-md:t.p2", 1, 1, "《论开端》，§1，说明，另一译者译"],
      ["k2", "sample:d02.p2", 1, 1, "《论尺度》，§1，说明，某译者译"],
      ["k3", "sample:d02.p4", 2, 2, "《论尺度》，§2，附释一，某译者译"],
    ]);
    assert.match(md, /> ——《论尺度》，§1，说明，某译者译\n\n## 从存在开始并非随意的选择\n/);
    assert.match(md, /> ……人们往往以为，开端只是一个可以随意选择的起点/);
    // 资料说明由实际引用重新推导（来源按工作目录顺序，与 assemble 相同）：旧书条目文字不变，新书条目加入
    assert.deepEqual(assembled.coverage.map((c) => c.sourceId), ["sample", "sample-md"]);
    assert.ok(head.includes("- 《论开端》，整理范围：全书；摘录出自 §1（正文、说明）\n"));
    assert.ok(md.includes("- 《论尺度》，整理范围：A．质 至 §2；摘录出自 §1（说明）、§2（附释一）\n- 《论开端》，整理范围：全书；摘录出自 §1（正文、说明）\n"));
    assert.ok(md.includes("- 《论尺度》：某译者译，示例出版社，2026\n- 《论开端》：另一译者译\n"));
    assert.equal(merge(wd).status, "unchanged");

    // validate：通过，含锁定段落检查
    assert.equal(ok("validate", "--workdir", wd, "--key", "cunzai")[0].ok, true);
    assert.deepEqual(json(file("validation.json")).findings, []);
    // submit 试运行：编辑以 head 为 base
    writeFileSync(
      file("review.json"),
      JSON.stringify({ schema: "phosky.book-pipeline/review@1", conceptKey: "cunzai", perspectiveSha256: sha256(md), reviewer: "审稿子代理", summary: "新增摘录支持论点。", issues: [] }),
    );
    const edit = ok("submit", "--workdir", wd, "--key", "cunzai").find((l) => l.opKey === "perspective:cunzai");
    assert.deepEqual([edit.state, edit.phase, edit.kind], ["send", "perspectives", "edit"]);
    const request = json(join(wd, "submit", "plan.json")).requests.find((r) => r.opKey === "perspective:cunzai").request;
    assert.deepEqual([request.pageId, request.baseRevisionId, request.content], [42, 9, md]);

    // 锁定段落被改动后 validate 报告 locked-block
    writeFileSync(file("perspective.md"), md.replace(LOCKED, LOCKED.replace("思维自身", "思维本身")));
    const run = pipeline("validate", "--workdir", wd, "--key", "cunzai");
    assert.equal(run.status, 1, run.stdout);
    assert.ok(json(file("validation.json")).findings.some((f) => f.rule === "locked-block"));
  }));

test("a human edit in the head's source notes is refused unless --rederive-footer accepts the re-derivation", () =>
  withWorkdir((wd, file) => {
    const edited = join(wd, "head-footer-edited.md");
    const original = "- 《论开端》：另一译者译\n";
    assert.ok(text(HEAD).includes(original), "fixture drifted");
    writeFileSync(edited, text(HEAD).replace(original, "- 《论开端》：另一译者译，人工补注的版次\n"));
    const args = ["incremental", "--workdir", wd, "--key", "cunzai", "--head", edited, "--head-revision", "9", "--last-ai", LAST_AI, "--last-ai-revision", "7"];
    assert.match(refused("INCREMENTAL_FOOTER_EDITED", ...args), /--rederive-footer/);
    assert.equal(existsSync(file("base.json")), false, "nothing is written");

    const run = pipeline(...args, "--rederive-footer");
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).footerHumanEdits, 1);
    assert.match(run.stderr, /re-derived/);
    // base.json 沿用时同样要求确认；确认后资料说明按引用重新推导，人工补注不再出现
    cpSync(CLAIM_MAP, file("claim-map.json"));
    refused("INCREMENTAL_FOOTER_EDITED", "incremental", "--workdir", wd, "--key", "cunzai");
    assert.equal(ok("incremental", "--workdir", wd, "--key", "cunzai", "--rederive-footer")[0].stage, "merged");
    assert.ok(!text(file("perspective.md")).includes("人工补注"));
  }));

test("incremental refuses rewrites, dropped claims and untraceable or mismatched input, writing nothing", () =>
  withWorkdir((wd, file) => {
    importHead(wd);
    const map = json(CLAIM_MAP);
    const baseText = text(file("base.json"));
    const tryMap = (code, mutate) => {
      const copy = structuredClone(map);
      mutate(copy);
      writeFileSync(file("claim-map.json"), JSON.stringify(copy));
      refused(code, "incremental", "--workdir", wd, "--key", "cunzai");
      assert.equal(existsSync(file("perspective.md")), false, code);
    };
    tryMap("INCREMENTAL_CLAIM_MAP", (m) => m.claims.splice(0, 1)); // 删掉既有论点
    tryMap("INCREMENTAL_CLAIM_MAP", (m) => m.claims.reverse()); // 打乱既有论点顺序
    tryMap("INCREMENTAL_CLAIM_MAP", (m) => (m.core = "范例思把存在看作直接的规定性。")); // 改写核心
    tryMap("INCREMENTAL_CLAIM_MAP", (m) => (m.claims[0].heading = "存在是直接规定性")); // 改写标题
    tryMap("INCREMENTAL_CLAIM_MAP", (m) => (m.claims[0].exposition = "补一句。")); // kept 却夹带新增
    tryMap("INCREMENTAL_CLAIM_MAP", (m) => (m.claims[2].heading = "存在不是经验事物")); // 新论点冒用既有标题
    tryMap("INCREMENTAL_CLAIM_MAP", (m) => (m.claims[1].excerpts[0].text = "会话写的引文")); // 引用夹带文字
    tryMap("ASSEMBLE_EXCERPT", (m) => (m.claims[2].excerpts = [{ paragraph: "sample:d03.p1", from: 1, to: 1 }])); // 范围外注释

    // head 中的摘录对不上冻结来源（被人改过引文）：无法精确回查，拒绝且不覆盖 base.json
    const tampered = join(wd, "head-tampered.md");
    writeFileSync(tampered, text(HEAD).replace("某种经验的事物。", "某种经验事物。"));
    refused("INCREMENTAL_EXCERPT_UNRESOLVED", "incremental", "--workdir", wd, "--key", "cunzai", "--head", tampered, "--head-revision", "10", "--no-last-ai");
    writeFileSync(tampered, "随手写的一段话，没有论点小节。\n");
    refused("INCREMENTAL_HEAD_TEMPLATE", "incremental", "--workdir", wd, "--key", "cunzai", "--head", tampered, "--head-revision", "10", "--no-last-ai");
    assert.equal(text(file("base.json")), baseText);

    refused("INCREMENTAL_PAGE_MISMATCH", "incremental", "--workdir", wd, "--key", "cunzai", "--head", HEAD, "--head-revision", "9", "--no-last-ai", "--page", "99");
    refused("INCREMENTAL_BASE_INVALID", "incremental", "--workdir", wd, "--key", "cunzai", "--head", HEAD, "--head-revision", "5", "--last-ai", LAST_AI, "--last-ai-revision", "7");
    refused("INCREMENTAL_NO_PERSPECTIVE", "incremental", "--workdir", wd, "--key", "kaiduan", "--head", HEAD, "--head-revision", "9", "--no-last-ai");
    refused("UNCONFIRMED", "incremental", "--workdir", wd, "--key", "liang", "--head", HEAD, "--head-revision", "9", "--no-last-ai");
    assert.equal(pipeline("incremental", "--workdir", wd, "--key", "cunzai", "--head", HEAD, "--head-revision", "9").status, 2);
  }));
