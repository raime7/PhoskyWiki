// 缝 2：candidates 与 confirm（#108）。夹具是预写的会话产物样例与站点导出，不调用大模型、不连数据库。
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const cli = join(root, "scripts/book-pipeline/cli.ts");
const candidatesModule = join(root, "scripts/book-pipeline/candidates.ts");
const fixtures = join(root, "scripts/book-pipeline/fixtures");
const TSX = ["--conditions=react-server", "--import", "tsx"];

function pipeline(...args) {
  return spawnSync(process.execPath, [...TSX, cli, ...args], { cwd: root, encoding: "utf8" });
}

function withWorkdir(fn, { session } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "book-pipeline-cand-"));
  try {
    const frozen = pipeline("freeze", join(fixtures, "sample-book.md"), "--workdir", dir, "--id", "sample", "--title", "论尺度", "--author", "范例思");
    assert.equal(frozen.status, 0, frozen.stderr);
    mkdirSync(join(dir, "candidates"), { recursive: true });
    cpSync(join(fixtures, "candidates/site-terms.json"), join(dir, "candidates/site-terms.json"));
    const sessionPath = join(dir, "candidates/session-candidates.json");
    const base = JSON.parse(readFileSync(join(fixtures, "candidates/session-candidates.json"), "utf8"));
    writeFileSync(sessionPath, JSON.stringify(session ? session(base) : base));
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const readList = (dir) => JSON.parse(readFileSync(join(dir, "candidates/candidates.json"), "utf8"));
const candidates = (dir) => pipeline("candidates", "--workdir", dir);
const confirm = (dir, ...rest) => pipeline("confirm", "--workdir", dir, "--by", "站长", ...rest);

// 后续命令（assemble）使用的确认闸门，直接调用 requireConfirmed()
function gate(dir, key) {
  const code =
    `import {requireConfirmed} from ${JSON.stringify(candidatesModule)};` +
    `try{console.log(JSON.stringify(requireConfirmed(${JSON.stringify(dir)}${key ? `,${JSON.stringify(key)}` : ""})))}catch(e){console.log(e.message)}`;
  return spawnSync(process.execPath, [...TSX, "--input-type=module", "-e", code], { cwd: root, encoding: "utf8" }).stdout.trim();
}

test("candidates matches existing terms by title and alias, and excludes sub-threshold concepts with reasons", () =>
  withWorkdir((dir) => {
    const run = candidates(dir);
    assert.equal(run.status, 0, run.stderr);
    const list = readList(dir);
    assert.equal(list.interpreter, "范例思");
    assert.deepEqual(list.entries.map((e) => e.key), ["chidu", "zhijiexing", "guidingxing", "ziguanxi"]);
    const by = Object.fromEntries(list.entries.map((e) => [e.key, e]));
    assert.deepEqual(by.chidu.existingTerm, { pageId: 10, title: "尺度", matchedBy: "title" });
    assert.deepEqual(by.chidu.existingPerspective, { pageId: 30, headRevisionId: 300 });
    assert.deepEqual(by.chidu.related, ["质"]);
    // 新建词条带会话给出的中性词条简介；已有词条不用
    assert.equal(by.guidingxing.termSummary, "规定性：使某物成为其所是、并与他物相区别的特征。");
    assert.equal(by.chidu.termSummary, null);
    // 别名命中；已有视角属于别的诠释者，不算本诠释者的视角
    assert.deepEqual(by.zhijiexing.existingTerm, { pageId: 11, title: "直接存在", matchedBy: "alias" });
    assert.equal(by.zhijiexing.existingPerspective, null);
    // 同名但已删除的词条不匹配
    assert.equal(by.guidingxing.existingTerm, null);
    assert.deepEqual(by.chidu.admission, ["claims>=2", "central-paragraph"]);
    assert.deepEqual(by.guidingxing.admission, ["claims>=2"]);
    assert.deepEqual(by.ziguanxi.admission, ["central-paragraph"]);
    assert.equal(by.ziguanxi.proposedClaimCount, 1);
    assert.deepEqual(by.chidu.evidenceParagraphs, ["sample:t.p1", "sample:t.p2"]);
    assert.deepEqual(list.excluded.map((e) => e.key), ["bianzhengfa", "zhiliang"]);
    assert.match(list.excluded[0].reason, /顺带提及/);
    assert.match(list.excluded[1].reason, /未达准入门槛/);
    // 重跑逐字节一致，且报告 unchanged
    const before = readFileSync(join(dir, "candidates/candidates.json"));
    assert.equal(JSON.parse(candidates(dir).stdout).status, "unchanged");
    assert.deepEqual(readFileSync(join(dir, "candidates/candidates.json")), before);
  }));

test("a new term whose title equals a deleted term is blocked and can not be confirmed; no check without deletedTermTitles", () => {
  const sitePath = (dir) => join(dir, "candidates/site-terms.json");
  const setDeleted = (dir, titles) => {
    const site = JSON.parse(readFileSync(sitePath(dir), "utf8"));
    site.deletedTermTitles = titles;
    writeFileSync(sitePath(dir), JSON.stringify(site));
  };
  withWorkdir((dir) => {
    setDeleted(dir, ["规定性", "别的已删词条"]);
    const run = candidates(dir);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).blocked, 1);
    const list = readList(dir);
    assert.deepEqual(list.entries.map((e) => e.key), ["chidu", "zhijiexing", "ziguanxi"]);
    assert.deepEqual(list.blocked.map((b) => [b.key, b.canonicalName]), [["guidingxing", "规定性"]]);
    assert.match(list.blocked[0].reason, /^与已删除词条同名：先在站上恢复该词条，再重新 export-site 与 candidates$/);
    const blocked = confirm(dir, "--keys", "guidingxing");
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /NOT_CONFIRMABLE: guidingxing is blocked: 与已删除词条同名/);
    assert.equal(confirm(dir, "--all").status, 0);
    assert.deepEqual(JSON.parse(gate(dir)), ["chidu", "zhijiexing", "ziguanxi"]);
  });
  // 站点导出没做检查（null）：不拦
  withWorkdir((dir) => {
    setDeleted(dir, null);
    assert.equal(candidates(dir).status, 0);
    assert.deepEqual(readList(dir).blocked, []);
    assert.ok(readList(dir).entries.some((e) => e.key === "guidingxing"));
  });
});

test("an unconfirmed list can not pass the gate; regenerating a changed list invalidates the confirmation", () =>
  withWorkdir((dir) => {
    assert.match(gate(dir), /^UNCONFIRMED/);
    assert.equal(candidates(dir).status, 0);
    assert.match(gate(dir), /^UNCONFIRMED: candidate list has not been confirmed/);

    const excluded = confirm(dir, "--keys", "zhiliang");
    assert.equal(excluded.status, 1);
    assert.match(excluded.stderr, /NOT_CONFIRMABLE: zhiliang was excluded/);
    assert.equal(confirm(dir, "--keys", "nope").status, 1);
    assert.equal(confirm(dir).status, 2);
    assert.match(gate(dir), /^UNCONFIRMED/);

    const ok = confirm(dir, "--keys", "chidu,ziguanxi");
    assert.equal(ok.status, 0, ok.stderr);
    const conf = JSON.parse(readFileSync(join(dir, "candidates/confirmation.json"), "utf8"));
    assert.deepEqual(conf.confirmed, ["chidu", "ziguanxi"]);
    assert.equal(conf.confirmedBy, "站长");
    assert.deepEqual(JSON.parse(gate(dir)), ["chidu", "ziguanxi"]);
    assert.match(gate(dir, "zhijiexing"), /not among the confirmed/);

    // 会话产物改动：旧清单过期，不能再确认；重新生成后旧确认失效
    const sessionPath = join(dir, "candidates/session-candidates.json");
    const session = JSON.parse(readFileSync(sessionPath, "utf8"));
    session.candidates = session.candidates.filter((c) => c.key !== "ziguanxi");
    writeFileSync(sessionPath, JSON.stringify(session));
    const stale = confirm(dir, "--all");
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /STALE_LIST/);
    assert.equal(JSON.parse(candidates(dir).stdout).confirmationInvalidated, true);
    assert.match(gate(dir), /^UNCONFIRMED: candidates.json changed after confirmation/);
    assert.equal(confirm(dir, "--all").status, 0);
    assert.deepEqual(JSON.parse(gate(dir)), ["chidu", "zhijiexing", "guidingxing"]);
  }));

test("pseudo-interpreters, duplicated concepts, ambiguous matches and unknown paragraphs are rejected", () => {
  const rejects = (mutate, code) =>
    withWorkdir(
      (dir) => {
        const run = candidates(dir);
        assert.equal(run.status, 1, code);
        assert.match(run.stderr, new RegExp(`^${code}:`));
        assert.equal(existsSync(join(dir, "candidates/candidates.json")), false);
      },
      { session: mutate },
    );
  rejects((s) => ({ ...s, interpreter: "编委会" }), "PSEUDO_INTERPRETER");
  rejects((s) => ({ ...s, interpreter: "别人" }), "WORKDIR_INTERPRETER");
  // 同一概念没有合并：名称与另一候选的别名重叠
  rejects((s) => ({ ...s, candidates: [...s.candidates, { ...s.candidates[0], key: "chidu2", canonicalName: "度量" }] }), "DUPLICATE_CONCEPT");
  rejects((s) => ({ ...s, candidates: [...s.candidates, { ...s.candidates[0] }] }), "DUPLICATE_KEY");
  // 两个候选命中同一已有词条
  rejects((s) => ({ ...s, candidates: [...s.candidates, { ...s.candidates[3], key: "du", canonicalName: "度", aliases: [] }] }), "DUPLICATE_CONCEPT");
  // 一个候选同时命中两个已有词条
  rejects((s) => ({ ...s, candidates: [{ ...s.candidates[0], aliases: ["直接性"] }] }), "AMBIGUOUS_TERM");
  rejects((s) => ({ ...s, candidates: [{ ...s.candidates[3], centralParagraphs: ["sample:t.p99"] }] }), "UNKNOWN_PARAGRAPH");
  // 站上没有的词条须有中性的一句话简介（新建词条的 summary 不能借用诠释者的一句话核心）
  rejects((s) => ({ ...s, candidates: [{ ...s.candidates[3], termSummary: null }] }), "TERM_SUMMARY_MISSING");
  rejects((s) => ({ ...s, candidates: [{ ...s.candidates[3], termSummary: "  " }] }), "TERM_SUMMARY_MISSING");
});
