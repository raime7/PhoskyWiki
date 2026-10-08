// 缝 2：书籍流水线工作目录（CLI）——assemble（#109）。只看给定输入产出的文件，不测内部拆分。
// 论点映射是手写的会话产物样例（fixtures/assemble/），不调用任何模型；确认文件按 types.ts 契约在测试中写出。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const cli = join(root, "scripts/book-pipeline/cli.ts");
const template = join(root, "scripts/book-pipeline/template.ts");
const fixtures = join(root, "scripts/book-pipeline/fixtures");
const BOOK = ["--author", "范例思"];

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const rows = (path) => readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

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

/** 经 template.ts（站点自己的解析与渲染管线）检查组装结果。 */
function inspect(markdown) {
  const run = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e",
      `import { parsePerspectiveMarkdown, renderedExcerpts } from ${JSON.stringify(template)};
       const md = process.argv[1];
       console.log(JSON.stringify({ parsed: parsePerspectiveMarkdown(md), visible: renderedExcerpts(md) }));`, markdown],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

function confirm(wd, keys) {
  const list = readFileSync(join(wd, "candidates", "candidates.json"));
  writeFileSync(
    join(wd, "candidates", "confirmation.json"),
    JSON.stringify({ schema: "phosky.book-pipeline/confirmation@1", candidateListSha256: sha256(list), confirmedBy: "站长", confirmedAt: "2026-10-08T00:00:00.000Z", confirmed: keys }, null, 2) + "\n",
  );
}

function claimMap(wd, key, edit) {
  const path = join(wd, "perspectives", key, "claim-map.json");
  mkdirSync(join(wd, "perspectives", key), { recursive: true });
  const map = json(join(fixtures, "assemble", `claim-map.${key}.json`));
  writeFileSync(path, JSON.stringify(edit ? edit(map) ?? map : map, null, 2) + "\n");
}

/** 两本同一诠释者的书冻结进同一工作目录，放入手写候选清单与论点映射。 */
function withWorkdir(fn, { confirmed = ["kaiduan", "cunzai"] } = {}) {
  const wd = mkdtempSync(join(tmpdir(), "book-pipeline-assemble-"));
  try {
    ok("freeze", join(fixtures, "sample-book.epub"), "--workdir", wd, "--id", "sample", ...BOOK,
      "--title", "论尺度", "--translator", "某译者", "--edition", "示例出版社，2026", "--from", "A．质", "--to", "§ 2");
    ok("freeze", join(fixtures, "sample-book.md"), "--workdir", wd, "--id", "sample-md", ...BOOK, "--title", "论开端", "--translator", "另一译者");
    mkdirSync(join(wd, "candidates"));
    cpSync(join(fixtures, "assemble", "candidates.json"), join(wd, "candidates", "candidates.json"));
    claimMap(wd, "kaiduan");
    claimMap(wd, "cunzai");
    if (confirmed) confirm(wd, confirmed);
    return fn(wd);
  } finally {
    rmSync(wd, { recursive: true, force: true });
  }
}

const out = (wd, key, name) => join(wd, "perspectives", key, name);

/** 独立于实现，从冻结段落按句子范围取引文。 */
function frozenQuote(wd, { paragraph, from, to }) {
  const p = rows(join(wd, "sources", paragraph.split(":")[0], "paragraphs.jsonl")).find((row) => row.id === paragraph);
  return p.text.slice(p.sentences[from - 1].start, p.sentences[to - 1].end);
}

test("assemble backfills excerpts verbatim, marks truncation, and adds citations, coverage, translation and the AI notice", () =>
  withWorkdir((wd) => {
    assert.deepEqual(
      ok("assemble", "--workdir", wd).map((r) => [r.key, r.status, r.mode, r.excerpts]),
      [["kaiduan", "written", "new", 6], ["cunzai", "written", "edit", 2]],
    );
    const markdown = readFileSync(out(wd, "kaiduan", "perspective.md"), "utf8");
    const assembled = json(out(wd, "kaiduan", "assembled.json"));

    // 引文：与冻结来源逐字一致；截断处（不从首句起 / 不到末句止）标“……”
    assert.deepEqual(
      assembled.excerpts.map((e) => [e.claimId, e.ref.paragraph, e.truncatedStart, e.truncatedEnd]),
      [
        ["k1", "sample:d02.p1", false, false],
        ["k1", "sample:d02.p2", false, false],
        ["k2", "sample:d02.p4", false, true],
        ["k2", "sample:d02.p4", true, false],
        ["k3", "sample:d02.p4", true, true],
        ["k3", "sample:d02.p5", true, false],
      ],
    );
    for (const excerpt of assembled.excerpts) assert.equal(excerpt.text, frozenQuote(wd, excerpt.ref));

    // 站点渲染后的可见引文 = 截断标记 + 冻结原文；强调（含紧邻中文标点的“附释一：”）保留
    const { parsed, visible } = inspect(markdown);
    assert.deepEqual(
      visible.map((v) => v.text),
      assembled.excerpts.map((e) => `${e.truncatedStart ? "……" : ""}${e.text}${e.truncatedEnd ? "……" : ""}`),
    );
    assert.equal(visible[2].text.endsWith("“开端是最困难的。”[1]……"), true);
    assert.equal(visible[5].text, "……这里有一条作者原注*。");
    assert.deepEqual(visible[0].emphasis, [{ start: 3, end: 6, kind: "strong" }, { start: 21, end: 24, kind: "em" }]);
    assert.deepEqual(visible[1].emphasis, [{ start: 35, end: 37, kind: "strong" }]);
    assert.deepEqual(visible[2].emphasis, [{ start: 0, end: 4, kind: "strong" }]);
    assert.deepEqual(visible.slice(3).map((v) => v.emphasis), [[], [], []]);

    // 出处：著作、节号、层次、译本
    assert.deepEqual(visible.map((v) => v.citation), [
      "——《论尺度》，§1，正文，某译者译",
      "——《论尺度》，§1，说明，某译者译",
      "——《论尺度》，§2，附释一，某译者译",
      "——《论尺度》，§2，附释一，某译者译",
      "——《论尺度》，§2，附释一，某译者译",
      "——《论尺度》，§2，附释一，某译者译",
    ]);
    assert.deepEqual(assembled.excerpts.map((e) => e.citation), visible.map((v) => v.citation.slice(2)));

    // 模板：一句话核心 → 论点（解读 + 摘录）→ 分隔线 → 覆盖范围、译本、AI 说明
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.core, "范例思把开端（Anfang）理解为直接的规定性，它的困难本身就是思维首先要考察的对象。");
    assert.deepEqual(parsed.claims.map((c) => [c.heading, c.excerpts.length]), [
      ["开端是直接的规定性", 2],
      ["开端的困难本身是考察对象", 2],
      ["开端的两难", 2],
    ]);
    assert.match(parsed.claims[0].exposition, /\[\[存在\|存在\]\]/);
    assert.match(parsed.claims[2].exposition, /^开端若已有规定[\s\S]*\n- 这一两难/);
    assert.deepEqual(parsed.coverage, ["《论尺度》，整理范围：A．质 至 §2；摘录出自 §1（正文、说明）、§2（附释一）"]);
    assert.deepEqual(parsed.translations, ["《论尺度》：某译者译，示例出版社，2026"]);
    assert.match(parsed.generation, /^本解读由 AI 生成、经管理员受理。/);
    assert.match(markdown, /\n---\n\n\*\*资料覆盖范围\*\*\n/);

    // 覆盖范围由实际引用推导：未被引用的段落（p3、p6）与未被引用的书（论开端）不列入
    assert.deepEqual(assembled.coverage, [
      {
        sourceId: "sample",
        title: "论尺度",
        translator: "某译者",
        edition: "示例出版社，2026",
        range: { from: "A．质", to: "§ 2" },
        paragraphs: ["sample:d02.p1", "sample:d02.p2", "sample:d02.p4", "sample:d02.p5"],
      },
    ]);

    // 产物绑定输入哈希；新建视角无 base
    assert.equal(assembled.schema, "phosky.book-pipeline/assembled@1");
    assert.deepEqual([assembled.term, assembled.interpreter, assembled.mode, assembled.baseRevisionId], ["开端", "范例思", "new", null]);
    assert.equal(assembled.markdownSha256, sha256(markdown));
    assert.deepEqual(assembled.inputs, {
      claimMap: sha256(readFileSync(out(wd, "kaiduan", "claim-map.json"))),
      candidateList: sha256(readFileSync(join(wd, "candidates", "candidates.json"))),
      confirmation: sha256(readFileSync(join(wd, "candidates", "confirmation.json"))),
    });

    // 已有视角 → 以 head 修订为 base 的编辑；两本书都被引用时按冻结顺序并列，引文同样逐字回填
    const edit = json(out(wd, "cunzai", "assembled.json"));
    assert.deepEqual([edit.mode, edit.baseRevisionId], ["edit", 7]);
    assert.deepEqual(edit.coverage.map((c) => [c.sourceId, c.paragraphs]), [["sample", ["sample:d02.p1"]], ["sample-md", ["sample-md:t.p2"]]]);
    const editView = inspect(readFileSync(out(wd, "cunzai", "perspective.md"), "utf8"));
    assert.deepEqual(editView.parsed.errors, []);
    assert.deepEqual(editView.visible.map((v) => [v.text, v.citation]), [
      ["〔说明〕这里所说的存在，不应当被理解为某种经验的事物。", "——《论开端》，§1，说明，另一译者译"],
      ["存在是直接的规定性。……", "——《论尺度》，§1，正文，某译者译"],
    ]);
    assert.deepEqual(editView.parsed.coverage, [
      "《论尺度》，整理范围：A．质 至 §2；摘录出自 §1（正文）",
      "《论开端》，整理范围：全书；摘录出自 §1（说明）",
    ]);
    assert.deepEqual(editView.parsed.translations, ["《论尺度》：某译者译，示例出版社，2026", "《论开端》：另一译者译"]);

    // 重跑逐字节一致
    const before = [readFileSync(out(wd, "kaiduan", "perspective.md")), readFileSync(out(wd, "kaiduan", "assembled.json"))];
    assert.deepEqual(ok("assemble", "--workdir", wd, "--key", "kaiduan").map((r) => r.status), ["unchanged"]);
    assert.deepEqual([readFileSync(out(wd, "kaiduan", "perspective.md")), readFileSync(out(wd, "kaiduan", "assembled.json"))], before);
  }));

test("quotation Markdown renders back to the exact source text and emphasis on the site pipeline", () => {
  // 形似 Markdown 语法的原文、紧邻中文标点的强调、重叠强调、首尾空白
  const cases = [
    ["1. 他说：“开端”，[[存在]] <b>&amp; `x` _y_ ~z~ \\ 完。", [[6, 10, "strong"], [8, 12, "em"]]],
    ["# 标题样 “引号强调”后文", [[6, 12, "strong"]]],
    ["- 列表样 强调 ", [[2, 8, "em"], [2, 8, "strong"]]],
    ["> 全段强调。", [[0, 7, "strong"]]],
    ["Sein und Nichts are one.", [[5, 8, "em"]]],
  ];
  const run = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e",
      `import { renderExcerpt, renderedExcerpts, expectedVisibleEmphasis, expectedVisibleQuote } from ${JSON.stringify(template)};
       for (const [text, spans] of JSON.parse(process.argv[1])) {
         const p = { id: "x:t.p1", text, emphasis: spans.map(([start, end, kind]) => ({ start, end, kind, via: "t" })),
                     sentences: [{ n: 1, start: 0, end: text.length }] };
         const r = renderExcerpt(p, { paragraph: p.id, from: 1, to: 1 });
         const v = renderedExcerpts("> " + r.markdown + "\\n>\\n> ——出处")[0];
         console.log(JSON.stringify({ text: v.text, want: expectedVisibleQuote(r), emphasis: v.emphasis,
                                      wantEmphasis: expectedVisibleEmphasis(r, r.emphasis), citation: v.citation }));
       }`, JSON.stringify(cases)],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const results = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(results.length, cases.length);
  results.forEach((r, i) => {
    assert.equal(r.text, r.want, `case ${i}`);
    assert.equal(r.text, cases[i][0].trim(), `case ${i}`);
    assert.deepEqual(r.emphasis, r.wantEmphasis, `case ${i}`);
    assert.equal(r.citation, "——出处");
  });
  assert.deepEqual(results[1].emphasis, [{ start: 6, end: 12, kind: "strong" }]);
  assert.deepEqual(results[2].emphasis, [{ start: 2, end: 8, kind: "em" }, { start: 2, end: 8, kind: "strong" }]);
});

test("assemble refuses an unconfirmed, stale or partial candidate confirmation", () =>
  withWorkdir(
    (wd) => {
      const written = () => ["kaiduan", "cunzai", "liang"].some((key) => existsSync(out(wd, key, "perspective.md")));
      refused("UNCONFIRMED", "assemble", "--workdir", wd);
      refused("UNCONFIRMED", "assemble", "--workdir", wd, "--key", "kaiduan");
      assert.equal(written(), false);

      // 只确认了 kaiduan：liang 即便已有论点映射也不能组装
      confirm(wd, ["kaiduan"]);
      mkdirSync(join(wd, "perspectives", "liang"));
      writeFileSync(out(wd, "liang", "claim-map.json"), readFileSync(out(wd, "kaiduan", "claim-map.json")));
      assert.match(refused("UNCONFIRMED", "assemble", "--workdir", wd, "--key", "liang"), /liang/);
      assert.equal(written(), false);

      // 确认后清单又变了：确认失效
      const list = join(wd, "candidates", "candidates.json");
      writeFileSync(list, readFileSync(list, "utf8").replace('"proposedClaimCount": 3', '"proposedClaimCount": 4'));
      refused("UNCONFIRMED", "assemble", "--workdir", wd, "--key", "kaiduan");
      assert.equal(written(), false);

      // 缺省只组装已确认的概念
      confirm(wd, ["kaiduan"]);
      assert.deepEqual(ok("assemble", "--workdir", wd).map((r) => r.key), ["kaiduan"]);
      assert.equal(existsSync(out(wd, "cunzai", "perspective.md")), false);
    },
    { confirmed: null },
  ));

test("assemble rejects excerpts it cannot backfill verbatim, session-written quotations and tampered sources", () =>
  withWorkdir((wd) => {
    const refs = (...excerpts) => (map) => {
      map.claims[0].excerpts = excerpts;
    };
    const cases = [
      ["ASSEMBLE_EXCERPT", refs({ paragraph: "sample:d02.p99", from: 1, to: 1 }), /unknown paragraph sample:d02\.p99/],
      ["ASSEMBLE_EXCERPT", refs({ paragraph: "sample:d02.p1", from: 1, to: 3 }), /sentences 1–2, got 1–3/],
      ["ASSEMBLE_EXCERPT", refs({ paragraph: "sample:d02.p1", from: 2, to: 1 }), /got 2–1/],
      ["ASSEMBLE_EXCERPT", refs({ paragraph: "sample:d03.p1", from: 1, to: 1 }), /outside the frozen range/],
      ["ASSEMBLE_EXCERPT", refs({ paragraph: "other:t.p1", from: 1, to: 1 }), /not frozen/],
      ["ASSEMBLE_CLAIM_MAP", refs({ paragraph: "sample:d02.p1", from: 1, to: 1, text: "存在是直接的规定性。" }), /never written by the session/],
      ["ASSEMBLE_CLAIM_MAP", (map) => void (map.claims[0].exposition = "解读。\n\n## 偷加的小节"), /paragraphs or lists only/],
      ["ASSEMBLE_CLAIM_MAP", (map) => void (map.claims[0].exposition = "> 模型自己写的“引文”"), /paragraphs or lists only/],
      ["ASSEMBLE_CLAIM_MAP", (map) => void (map.core = "第一句。\n\n第二段。"), /core/],
      ["ASSEMBLE_CLAIM_MAP", (map) => void (map.term = "量"), /term "量"/],
      ["ASSEMBLE_PSEUDO_INTERPRETER", (map) => void (map.interpreter = "编委会"), /ADR-0007/],
    ];
    for (const [code, edit, message] of cases) {
      claimMap(wd, "cunzai", edit);
      // 一个概念失败则整批都不落盘
      assert.match(refused(code, "assemble", "--workdir", wd), message);
      assert.equal(existsSync(out(wd, "kaiduan", "perspective.md")), false);
      assert.equal(existsSync(out(wd, "cunzai", "perspective.md")), false);
    }

    claimMap(wd, "cunzai");
    const paragraphs = join(wd, "sources", "sample", "paragraphs.jsonl");
    writeFileSync(paragraphs, readFileSync(paragraphs, "utf8").replace("绝不！", "绝不。"));
    refused("ASSEMBLE_SOURCE_TAMPERED", "assemble", "--workdir", wd, "--key", "kaiduan");
  }));
