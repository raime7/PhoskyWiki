// 缝 2：书籍流水线工作目录（CLI）——validate（#110）。只看给定输入产出的文件。
// 先用 assemble 产出合格的视角稿，再手工改坏 perspective.md / 辅助文件，逐类检查违规是否被报告。
// 夹具全是手写的（fixtures/assemble、fixtures/validate），不调用模型、不连数据库。
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
const BOOK = ["--author", "范例思"];

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function pipeline(...args) {
  return spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", cli, ...args], { cwd: root, encoding: "utf8" });
}

function ok(...args) {
  const run = pipeline(...args);
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim().split("\n").map((line) => JSON.parse(line));
}

const path = (wd, key, name) => join(wd, "perspectives", key, name);

/** 运行 validate：报告总会写出；返回进程结果与报告。 */
function validate(wd, key = "kaiduan") {
  const run = pipeline("validate", "--workdir", wd, "--key", key);
  return { run, report: json(path(wd, key, "validation.json")) };
}

function setup() {
  const wd = mkdtempSync(join(tmpdir(), "book-pipeline-validate-"));
  ok("freeze", join(fixtures, "sample-book.epub"), "--workdir", wd, "--id", "sample", ...BOOK,
    "--title", "论尺度", "--translator", "某译者", "--edition", "示例出版社，2026", "--from", "A．质", "--to", "§ 2");
  ok("freeze", join(fixtures, "sample-book.md"), "--workdir", wd, "--id", "sample-md", ...BOOK, "--title", "论开端", "--translator", "另一译者");
  mkdirSync(join(wd, "candidates"));
  cpSync(join(fixtures, "assemble", "candidates.json"), join(wd, "candidates", "candidates.json"));
  cpSync(join(fixtures, "validate", "site-terms.json"), join(wd, "candidates", "site-terms.json"));
  // 每篇都经过文风档案与润色：夹具的论点映射视为已润色（润色前副本与之相同）
  mkdirSync(join(wd, "style"));
  cpSync(join(fixtures, "style", "profile.md"), join(wd, "style", "profile.md"));
  for (const key of ["kaiduan", "cunzai"]) {
    mkdirSync(join(wd, "perspectives", key), { recursive: true });
    cpSync(join(fixtures, "assemble", `claim-map.${key}.json`), path(wd, key, "claim-map.json"));
    cpSync(join(fixtures, "assemble", `claim-map.${key}.json`), path(wd, key, "claim-map.pre-polish.json"));
  }
  const list = readFileSync(join(wd, "candidates", "candidates.json"));
  writeFileSync(
    join(wd, "candidates", "confirmation.json"),
    JSON.stringify({ schema: "phosky.book-pipeline/confirmation@1", candidateListSha256: sha256(list), confirmedBy: "站长", confirmedAt: "2026-10-08T00:00:00.000Z", confirmed: ["kaiduan", "cunzai"] }, null, 2) + "\n",
  );
  ok("assemble", "--workdir", wd, "--key", "kaiduan", "--rewrite", "cunzai");
  return wd;
}

/** 在已组装稿上做字符串替换（必须命中）；fresh = 同步 assembled.json 的哈希，使精确回查生效。 */
function edit(wd, key, replacements, { fresh = false } = {}) {
  let md = readFileSync(path(wd, key, "perspective.md"), "utf8");
  for (const [from, to] of replacements) {
    assert.ok(typeof from === "string" ? md.includes(from) : from.test(md), `fixture drifted: ${from}`);
    md = md.replace(from, to);
  }
  writeFileSync(path(wd, key, "perspective.md"), md);
  if (fresh) {
    const assembled = json(path(wd, key, "assembled.json"));
    assembled.markdownSha256 = sha256(md);
    writeFileSync(path(wd, key, "assembled.json"), JSON.stringify(assembled, null, 2) + "\n");
  }
  return md;
}

const pristine = {};
function restorer(wd, key = "kaiduan") {
  pristine[key] ??= { md: readFileSync(path(wd, key, "perspective.md"), "utf8"), assembled: readFileSync(path(wd, key, "assembled.json"), "utf8") };
  return () => {
    writeFileSync(path(wd, key, "perspective.md"), pristine[key].md);
    writeFileSync(path(wd, key, "assembled.json"), pristine[key].assembled);
  };
}

const rules = (report) => report.findings.map((f) => f.rule);
const has = (report, rule, pattern, claimId) =>
  report.findings.some((f) => f.rule === rule && pattern.test(f.message) && (claimId === undefined || f.claimId === claimId));

test("validate reports every violation class, honours limit overrides, and checks locked blocks", () => {
  const wd = setup();
  try {
    const reset = restorer(wd);

    // 合格的稿子：无发现项；报告绑定稿子哈希，随命令输出审稿报告状态
    {
      const run = pipeline("validate", "--workdir", wd);
      assert.equal(run.status, 0, run.stderr);
      const results = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
      assert.deepEqual(results.map((r) => [r.key, r.ok, r.errors, r.limits, r.review.status]), [["kaiduan", true, 0, 0, "missing"], ["cunzai", true, 0, 0, "missing"]]);
      assert.deepEqual(json(path(wd, "kaiduan", "validation.json")), {
        schema: "phosky.book-pipeline/validation@2",
        conceptKey: "kaiduan",
        perspectiveSha256: sha256(readFileSync(path(wd, "kaiduan", "perspective.md"))),
        ok: true,
        findings: [],
        overridden: [],
        hints: [],
      });
    }

    // 审稿报告的落盘位置：perspectives/<key>/review.json，绑定稿子哈希；稿子变了即“过期”
    {
      const md = readFileSync(path(wd, "kaiduan", "perspective.md"));
      const review = { schema: "phosky.book-pipeline/review@1", conceptKey: "kaiduan", perspectiveSha256: sha256(md), reviewer: "审稿子代理", summary: "", issues: [{ claimId: "k1", kind: "overreach", severity: "blocker", message: "x", excerpt: null }] };
      writeFileSync(path(wd, "kaiduan", "review.json"), JSON.stringify(review));
      assert.deepEqual(ok("validate", "--workdir", wd, "--key", "kaiduan")[0].review, { status: "current", blockers: 1 });
      edit(wd, "kaiduan", [["开端的两难", "开端的两难（改）"]]);
      assert.deepEqual(ok("validate", "--workdir", wd, "--key", "kaiduan")[0].review, { status: "stale", blockers: 1 });
      reset();
    }

    // 硬上限：论点 > 5、每论点摘录 > 3、单段摘录 > 200 字、解读 > 1500 字
    {
      const md = readFileSync(path(wd, "kaiduan", "perspective.md"), "utf8");
      const body = md.slice(md.indexOf("## "), md.indexOf("\n---\n")).trimEnd();
      const sections = body.split(/\n\n(?=## )/);
      assert.equal(sections.length, 3);
      const k1Quote = sections[0].slice(sections[0].indexOf("> "));
      const sixClaims = [[body, body + "\n\n" + body]]; // 3 + 3 = 6 个论点
      edit(wd, "kaiduan", sixClaims);
      let { run, report } = validate(wd);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /^VALIDATION_FAILED: kaiduan/);
      assert.deepEqual(report.findings.map((f) => [f.rule, f.severity, f.claimId]), [["limit.claims", "limit", null]]);
      assert.equal(report.ok, false);
      reset();

      edit(wd, "kaiduan", [[k1Quote, `${k1Quote}\n\n${k1Quote}`]]); // 论点 k1 有 2 + 2 = 4 段
      ({ report } = validate(wd));
      assert.deepEqual(report.findings.map((f) => [f.rule, f.severity, f.claimId]), [["limit.excerpts-per-claim", "limit", "k1"]]);
      reset();

      edit(wd, "kaiduan", [["范例思所说的开端", "很长的解读。".repeat(300) + "范例思所说的开端"]]);
      ({ report } = validate(wd));
      assert.deepEqual(report.findings.map((f) => [f.rule, f.severity]), [["limit.exposition-length", "limit"]]);
      reset();

      edit(wd, "kaiduan", [[/^> .*$/m, `> ${"极".repeat(201)}`]]);
      ({ report } = validate(wd));
      assert.ok(has(report, "limit.excerpt-length", /201 字/, "k1"));
      assert.ok(has(report, "quotation", /找不到逐字出处/, "k1"), "an over-long invented quote is also not verbatim");
      reset();

      // 人工放行：只有 limit.* 可放行，须指明规则与论点，写明理由与批准人
      edit(wd, "kaiduan", sixClaims);
      writeFileSync(path(wd, "kaiduan", "overrides.json"), JSON.stringify([{ rule: "limit.claims", claimId: "k2", reason: "r", approvedBy: "站长" }]));
      assert.equal(validate(wd).report.ok, false, "an override for another claim does not apply");
      const override = { rule: "limit.claims", claimId: null, reason: "本词条确有六个论点", approvedBy: "站长" };
      writeFileSync(path(wd, "kaiduan", "overrides.json"), JSON.stringify([override]));
      ({ run, report } = validate(wd));
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual([report.ok, report.findings, report.overridden], [true, [], [override]]);
      writeFileSync(path(wd, "kaiduan", "overrides.json"), JSON.stringify([{ rule: "quotation", claimId: null, reason: "r", approvedBy: "站长" }]));
      const refused = pipeline("validate", "--workdir", wd, "--key", "kaiduan");
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /^OVERRIDES_INVALID: /);
      rmSync(path(wd, "kaiduan", "overrides.json"));
      reset();
    }

    // 模板缺节
    {
      edit(wd, "kaiduan", [["**译本**\n\n- 《论尺度》：某译者译，示例出版社，2026\n\n", ""]]);
      const { report } = validate(wd);
      assert.ok(has(report, "template", /缺少「译本」/));
      assert.ok(report.findings.every((f) => f.severity === "error"));
      reset();
      edit(wd, "kaiduan", [["\n---\n", "\n"]]);
      assert.ok(has(validate(wd).report, "template", /分隔线/));
      reset();
    }

    // 双链：未知目标、@ 误用；合法的显式视角双链（站上存在该视角）不报
    {
      edit(wd, "kaiduan", [["[[存在|存在]]", "[[不存在的词条]]、[[尺度|度@范例思]]、[[开端|x@没有此人]]、[[尺度|y@别的诠释者]]"]]);
      let { report } = validate(wd);
      assert.deepEqual(rules(report), ["wikilink.unknown-target", "wikilink.unknown-target", "wikilink.unknown-target"]);
      assert.ok(has(report, "wikilink.unknown-target", /「不存在的词条」不是站上已有词条/));
      assert.ok(has(report, "wikilink.unknown-target", /诠释者「没有此人」不存在/));
      assert.ok(has(report, "wikilink.unknown-target", /尺度\|…@别的诠释者」指向的视角不存在/));
      reset();

      edit(wd, "kaiduan", [["[[存在|存在]]", "[[存在|@范例思]] [[存在|x@]] [[存在@乙]] [[存在|a@b@范例思]]"]]);
      ({ report } = validate(wd));
      const reserved = report.findings.filter((f) => f.rule === "wikilink.reserved-at");
      assert.equal(reserved.length, 4, JSON.stringify(report.findings));
      assert.ok(reserved.every((f) => f.claimId === "k1" && f.severity === "error"), "attributed to the claim holding the link");
      assert.ok(has(report, "wikilink.reserved-at", /@ 之前缺少显示文字/));
      assert.ok(has(report, "wikilink.reserved-at", /@ 之后缺少诠释者名/));
      assert.ok(has(report, "wikilink.reserved-at", /词条名中不得含保留字符 @/));
      assert.ok(has(report, "wikilink.reserved-at", /显示文字中不得含 @/));
      reset();
    }

    // 资料覆盖范围与实际引用不一致：范围写错、列了未引用的书、漏列
    {
      edit(wd, "kaiduan", [["- 《论尺度》，整理范围：A．质 至 §2；摘录出自 §1（正文、说明）、§2（附释一）", "- 《论尺度》，整理范围：全书；摘录出自 §1（正文、说明）、§2（附释一）\n- 《论开端》，整理范围：全书；摘录出自 §1（说明）"]]);
      const { report } = validate(wd);
      assert.ok(has(report, "coverage", /应为「《论尺度》，整理范围：A．质 至 §2；摘录出自 §1（正文、说明）、§2（附释一）」/));
      assert.ok(has(report, "coverage", /列出了没有被引用的资料：「《论开端》/));
      reset();
      edit(wd, "kaiduan", [["- 《论尺度》：某译者译，示例出版社，2026", "- 《论尺度》：某译者译"]]);
      assert.ok(has(validate(wd).report, "coverage", /「译本」中《论尺度》应为/));
      reset();
      // 引用了第二本书却没有列入覆盖范围（cunzai 同时引用两本）
      const resetSecond = restorer(wd, "cunzai");
      edit(wd, "cunzai", [["- 《论开端》，整理范围：全书；摘录出自 §1（说明）\n", ""]]);
      assert.ok(has(validate(wd, "cunzai").report, "coverage", /「资料覆盖范围」缺少实际引用的《论开端》/));
      resetSecond();
    }

    // 伪诠释者（ADR-0007）：双链里的诠释者、论点映射里的诠释者
    {
      edit(wd, "kaiduan", [["[[存在|存在]]", "[[存在|存在@编委会]]"]]);
      let { report } = validate(wd);
      assert.ok(has(report, "pseudo-interpreter", /双链中的诠释者「编委会」/));
      reset();
      const map = readFileSync(path(wd, "kaiduan", "claim-map.json"), "utf8");
      writeFileSync(path(wd, "kaiduan", "claim-map.json"), map.replace('"interpreter": "范例思"', '"interpreter": "站方"'));
      ({ report } = validate(wd));
      assert.ok(has(report, "pseudo-interpreter", /论点映射诠释者「站方」/));
      writeFileSync(path(wd, "kaiduan", "claim-map.json"), map);
    }

    // 引文不可回查：改字（精确路径，assembled.json 新鲜）、改字（退化路径）、截断标记被去掉、出处被改
    {
      edit(wd, "kaiduan", [["规定性。", "间接性。"]], { fresh: true });
      let { report } = validate(wd);
      assert.ok(has(report, "quotation", /与冻结来源 sample:d02\.p1 不一致/, "k1"), JSON.stringify(report.findings));
      reset();
      edit(wd, "kaiduan", [["规定性。", "间接性。"]]);
      ({ report } = validate(wd));
      assert.ok(has(report, "quotation", /找不到逐字出处/, "k1"));
      reset();
      edit(wd, "kaiduan", [["……", ""]], { fresh: true });
      assert.ok(has(validate(wd).report, "quotation", /与冻结来源/));
      reset();
      edit(wd, "kaiduan", [["——《论尺度》，§1，正文，某译者译", "——《论尺度》，§1，正文，别人译"]], { fresh: true });
      assert.ok(has(validate(wd).report, "quotation", /出处「——《论尺度》，§1，正文，别人译」应为/));
      reset();
      edit(wd, "kaiduan", [["——《论尺度》，§1，正文，某译者译", "——《论尺度》，§1，正文，别人译"]]);
      assert.ok(has(validate(wd).report, "quotation", /与引文所在段落 sample:d02\.p1 不符/));
      reset();
    }

    // 增量更新：锁定段落须逐字保留（锁定信息按 types.ts 的 LockInfo；块 = 顶层 Markdown 块）
    {
      const md = readFileSync(path(wd, "kaiduan", "perspective.md"), "utf8");
      const locked = md.split("\n\n")[2];
      assert.match(locked, /^范例思所说的开端/);
      const locks = {
        schema: "phosky.book-pipeline/locks@1",
        pageId: 5,
        headRevisionId: 9,
        lastAiRevisionId: 8,
        blocks: [{ index: 2, sha256: sha256(locked), text: locked, reason: "human-edit" }],
      };
      writeFileSync(path(wd, "kaiduan", "locks.json"), JSON.stringify(locks));
      assert.equal(validate(wd).report.ok, true, "locked block kept verbatim");
      edit(wd, "kaiduan", [["范例思所说的开端不是", "范例思所说的开端并不是"]]);
      const { run, report } = validate(wd);
      assert.equal(run.status, 1);
      assert.deepEqual(report.findings.map((f) => [f.rule, f.severity]), [["locked-block", "error"]]);
      assert.match(report.findings[0].message, /锁定块 #2「范例思所说的开端不是/);
      reset();
      writeFileSync(path(wd, "kaiduan", "locks.json"), JSON.stringify({ ...locks, blocks: [{ ...locks.blocks[0], text: "别的文字" }] }));
      assert.ok(has(validate(wd).report, "locked-block", /哈希与文字不符/));
      rmSync(path(wd, "kaiduan", "locks.json"));
      // 编辑稿的 base 修订须与锁定信息对应（cunzai 的 base 是 7）
      writeFileSync(path(wd, "cunzai", "locks.json"), JSON.stringify({ ...locks, headRevisionId: 8, blocks: [] }));
      assert.ok(has(validate(wd, "cunzai").report, "locked-block", /针对修订 8，而本稿以修订 7 为基础/));
      rmSync(path(wd, "cunzai", "locks.json"));
    }

    // 候选清单未确认：显式指定概念时报告 unconfirmed；缺省（全部已确认概念）则被闸门拒绝
    {
      const confirmation = readFileSync(join(wd, "candidates", "confirmation.json"));
      rmSync(join(wd, "candidates", "confirmation.json"));
      const { run, report } = validate(wd);
      assert.equal(run.status, 1);
      assert.ok(has(report, "unconfirmed", /未确认/));
      const gate = pipeline("validate", "--workdir", wd);
      assert.equal(gate.status, 1);
      assert.match(gate.stderr, /^UNCONFIRMED: /);
      writeFileSync(join(wd, "candidates", "confirmation.json"), confirmation);
      assert.equal(existsSync(path(wd, "kaiduan", "validation.json")), true);
    }

    // 重跑逐字节一致
    {
      ok("validate", "--workdir", wd, "--key", "kaiduan");
      const first = readFileSync(path(wd, "kaiduan", "validation.json"));
      ok("validate", "--workdir", wd, "--key", "kaiduan");
      assert.deepEqual(readFileSync(path(wd, "kaiduan", "validation.json")), first);
      assert.deepEqual(rules(json(path(wd, "kaiduan", "validation.json"))), []);
    }
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
});

test("exposition must not copy frozen source text outside excerpts (≥ 20 chars, whitespace ignored); head blocks are exempt", () => {
  const wd = setup();
  try {
    const reset = restorer(wd);
    const verbatim = (report) => report.findings.filter((f) => f.rule === "exposition.verbatim-source");
    // sample:d02.p4 第 7 句开头恰好 20 字
    const twenty = "我们毋宁应当把这种困难本身当作考察的对象";
    assert.equal(Array.from(twenty).length, 20);

    // 19 字不报，20 字报；报告给出字数、段落和所在论点，且不可放行（error）
    edit(wd, "kaiduan", [["通常的看法以为开端可以随意选取。", `${twenty.slice(0, -1)}照此。`]], { fresh: true });
    assert.deepEqual(verbatim(validate(wd).report), []);
    reset();
    edit(wd, "kaiduan", [["通常的看法以为开端可以随意选取。", `${twenty}。`]], { fresh: true });
    let { run, report } = validate(wd);
    assert.equal(run.status, 1);
    assert.deepEqual(verbatim(report).map((f) => [f.severity, f.claimId]), [["error", "k2"]]);
    assert.match(verbatim(report)[0].message, /解读中有 20 字与冻结来源 sample:d02\.p4 逐字相同/);
    reset();

    // 空白与软换行不能绕过；较长的照录报告整段的长度；短引语（如格言）照常允许
    edit(wd, "kaiduan", [["通常的看法以为开端可以随意选取。", "人们往往以为， 开端只是一个可以\n随意选择的起点，仿佛无论从哪里出发。他引过“开端是最困难的。”这句话。"]], { fresh: true });
    ({ report } = validate(wd));
    assert.equal(verbatim(report).length, 1, JSON.stringify(report.findings));
    assert.match(verbatim(report)[0].message, /有 32 字与冻结来源 sample:d02\.p4/);
    reset();

    // 一句话核心同样受限（claimId 为 null）
    edit(wd, "kaiduan", [["范例思把开端（Anfang）理解为直接的规定性", `范例思说${twenty}，并把开端（Anfang）理解为直接的规定性`]], { fresh: true });
    ({ report } = validate(wd));
    assert.deepEqual(verbatim(report).map((f) => f.claimId), [null]);
    assert.match(verbatim(report)[0].message, /^一句话核心中有 21 字/);
    reset();

    // 增量与改写稿：与 base.json 的 head 逐字相同的块（已发表、不许改动）不再检查
    const md = edit(wd, "kaiduan", [["通常的看法以为开端可以随意选取。", `${twenty}。`]], { fresh: true });
    writeFileSync(path(wd, "kaiduan", "base.json"), JSON.stringify({ schema: "phosky.book-pipeline/incremental-base@1", pageId: 5, head: { revisionId: 9, content: md }, lastAi: null }));
    assert.deepEqual(verbatim(validate(wd).report), []);
    rmSync(path(wd, "kaiduan", "base.json"));
    reset();
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
});

test("Chinese AI-writing patterns are non-blocking hints: listed per claim, never affecting ok", () => {
  const wd = setup();
  try {
    edit(wd, "kaiduan", [
      ["通常的看法以为开端可以随意选取。", "值得注意的是，通常的看法以为开端可以随意选取，这可以说明许多问题。"],
      ["它直接地就是它自己，不靠别的东西来规定。", "它不是被给予的，而是直接地就是它自己。"],
    ], { fresh: true });
    const run = pipeline("validate", "--workdir", wd, "--key", "kaiduan");
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout.trim()).hints, 2);
    const report = json(path(wd, "kaiduan", "validation.json"));
    assert.deepEqual([report.ok, report.findings], [true, []]);
    assert.deepEqual(
      report.hints.map((h) => [h.rule, h.claimId, h.message.slice(0, h.message.indexOf("："))]),
      [["style.ai-pattern", "k1", "「不是……而是」出现 2 次"], ["style.ai-pattern", "k2", "「值得注意的是」"]],
      "“可以说明”不算“可以说”；单个“不是……而是”不提示",
    );
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
});

test("every perspective needs the style profile and a polish pass that changed only core and exposition text", () => {
  const wd = setup();
  try {
    const only = (report, prefix) => report.findings.filter((f) => f.rule.startsWith(prefix)).map((f) => [f.rule, f.severity, f.claimId, f.message]);
    const profile = join(wd, "style", "profile.md");
    const original = readFileSync(profile, "utf8");

    // 文风档案：缺文件、缺小节都是 error
    rmSync(profile);
    let { run, report } = validate(wd);
    assert.equal(run.status, 1);
    assert.deepEqual(only(report, "style."), [["style.profile-missing", "error", null, "style/profile.md 不存在：写论点映射前先整理文风档案"]]);
    writeFileSync(profile, original.replace("## 论证次序", "## 论证").replace("## 仿写风险\n", ""));
    assert.deepEqual(only(validate(wd).report, "style.").map((f) => f[3]), ["style/profile.md 缺少小节：「论证次序」、「仿写风险」"]);
    writeFileSync(profile, original);

    // 没有润色前副本 = 没有润色
    const pre = path(wd, "kaiduan", "claim-map.pre-polish.json");
    const map = json(pre);
    rmSync(pre);
    ({ run, report } = validate(wd));
    assert.equal(run.status, 1);
    assert.deepEqual(only(report, "polish.").map((f) => f.slice(0, 3)), [["polish.missing", "error", null]]);

    // 润色后的论点映射：只比较 claim-map.json 与润色前副本，perspective.md 不受影响
    const polished = (mutate, before = map) => {
      writeFileSync(pre, JSON.stringify(before, null, 2) + "\n");
      const after = structuredClone(before);
      mutate(after);
      writeFileSync(path(wd, "kaiduan", "claim-map.json"), JSON.stringify(after, null, 2) + "\n");
      return only(validate(wd).report, "polish.").map(([rule, , claimId, message]) => [rule, claimId, message]);
    };
    // 允许：改核心与解读的文字、双链的显示文字
    assert.deepEqual(polished((m) => {
      m.core = "范例思认为开端（Anfang）是直接的规定性，开端的困难正是思维要先考察的。";
      m.claims[0].exposition = m.claims[0].exposition.replace("[[存在|存在]]", "[[存在|有]]").replace("不靠别的东西来规定", "不由他物规定");
    }), []);
    // 不允许：其余任何结构
    assert.deepEqual(polished((m) => (m.term = "起点")), [["polish.structure-changed", null, "润色改动了 term：「开端」→「起点」"]]);
    assert.deepEqual(polished((m) => m.claims.reverse()), [["polish.structure-changed", null, "润色改动了论点的 ID 或顺序：[k1, k2, k3] → [k3, k2, k1]"]]);
    assert.deepEqual(polished((m) => (m.claims[1].heading = "开端的困难")), [["polish.structure-changed", "k2", "润色改动了 heading：「开端的困难本身是考察对象」→「开端的困难」"]]);
    assert.deepEqual(polished((m) => (m.claims[1].excerpts[1].to = 7)), [["polish.structure-changed", "k2", "润色改动了摘录引用"]]);
    assert.deepEqual(polished((m) => (m.claims[2].revision = "extended")), [["polish.structure-changed", "k3", "润色改动了 revision：「new」→「extended」"]]);
    assert.deepEqual(polished((m) => (m.claims[0].exposition = m.claims[0].exposition.replace("[[存在|存在]]", "[[开端|存在]]"))), [
      ["polish.structure-changed", "k1", "润色改变了解读的双链目标：[存在] → [开端]"],
    ]);
    assert.deepEqual(polished((m) => (m.core += "这与[[存在]]有关。")), [["polish.structure-changed", null, "润色改变了一句话核心的双链目标：[] → [存在]"]]);

    // 增量论点映射：核心照抄 head、kept 论点整体不动；extended / new 的解读照常可改
    const incremental = structuredClone(map);
    incremental.claims[0].revision = "kept";
    incremental.claims[0].exposition = "";
    incremental.claims[0].excerpts = [];
    incremental.claims[1].revision = "extended";
    assert.deepEqual(polished((m) => (m.claims[1].exposition = "追加的解读，润色过。"), incremental), []);
    assert.deepEqual(polished((m) => (m.core = "改写的核心。"), incremental), [["polish.structure-changed", null, "增量论点映射的一句话核心须照抄 head，润色不得改动"]]);
    assert.deepEqual(polished((m) => (m.claims[0].exposition = "补一句。"), incremental), [["polish.structure-changed", "k1", "保留（kept）的论点润色时不得改动"]]);
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
});
