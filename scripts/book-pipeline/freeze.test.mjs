// 缝 2：书籍流水线工作目录（CLI）——freeze（#107）。只看给定输入产出的文件，不测内部拆分。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const cli = join(root, "scripts/book-pipeline/cli.ts");
const fixtures = join(root, "scripts/book-pipeline/fixtures");
const EPUB = join(fixtures, "sample-book.epub");
const TXT = join(fixtures, "sample-book.txt");
const MD = join(fixtures, "sample-book.md");
const BOOK = ["--title", "论尺度", "--author", "范例思", "--translator", "某译者"];

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function pipeline(...args) {
  return spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function withWorkdir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "book-pipeline-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function freezeOk(...args) {
  const run = pipeline("freeze", ...args);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

const rows = (path) => readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const sentence = (p, n) => p.text.slice(p.sentences[n - 1].start, p.sentences[n - 1].end);
const spans = (p) => p.emphasis.map((e) => [p.text.slice(e.start, e.end), e.kind]);

function snapshot(dir) {
  return Object.fromEntries(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name))]));
}

test("EPUB freeze keeps layers, emphasis and linked notes, and records hashes", () =>
  withWorkdir((wd) => {
    const result = freezeOk(EPUB, "--workdir", wd, "--id", "sample", ...BOOK, "--from", "A．质", "--to", "§ 2");
    assert.equal(result.status, "created");
    const dir = join(wd, "sources", "sample");
    const paragraphs = rows(join(dir, "paragraphs.jsonl"));
    const byId = Object.fromEntries(paragraphs.map((p) => [p.id, p]));

    // 范围：A．质 起到 §2 止；B．量 之后不收；被注号引用的范围外注释另行收录
    assert.deepEqual(
      paragraphs.map((p) => [p.id, p.inRange, p.section, p.layerLabel]),
      [
        ["sample:d02.p1", true, "§1", "正文"],
        ["sample:d02.p2", true, "§1", "说明"],
        ["sample:d02.p3", true, "§1", "说明"],
        ["sample:d02.p4", true, "§2", "附释一"],
        ["sample:d02.p5", true, "§2", "附释一"],
        ["sample:d02.p6", true, "§2", "附释二"],
        ["sample:d03.p1", false, null, "译注"],
        ["sample:d03.p2", false, null, "原注"],
      ],
    );
    assert.deepEqual(byId["sample:d02.p1"].chapterPath, ["第一篇　存在", "A．质"]);

    // 强调：class 强调、em、b 均保留，偏移落在规范化文字上
    assert.deepEqual(spans(byId["sample:d02.p1"]), [["直接的", "strong"], ["它自己", "em"]]);
    assert.deepEqual(spans(byId["sample:d02.p2"]), [["开端", "strong"]]);
    assert.deepEqual(spans(byId["sample:d02.p4"]), [["附释一：", "strong"]]);

    // 实体解码、排版换行与 <br/> 合并（中文之间不插空格）并记入规范化日志
    assert.equal(byId["sample:d02.p1"].text, "存在是直接的规定性。它不是别的东西，而只是它自己。");
    assert.match(byId["sample:d02.p2"].text, /事物——它/);
    assert.equal(byId["sample:d02.p3"].text, "说明的第二段仍然属于说明层次。");
    const log = rows(join(dir, "normalization-log.jsonl"));
    assert.deepEqual(log.map((entry) => [entry.paragraph, entry.rules]), [
      ["sample:d02.p1", ["join-wrapped-cjk-lines"]],
      ["sample:d02.p3", ["join-wrapped-cjk-lines"]],
    ]);

    // 长段落切句：注号随句末归入本句，句子 ID 由段落 ID 派生
    const long = byId["sample:d02.p4"];
    assert.equal(long.sentences.length, 8);
    assert.equal(long.sentences[2].id, "sample:d02.p4.s3");
    assert.equal(sentence(long, 3), "正如人们常说的那样，“开端是最困难的。”[1]");
    assert.equal(sentence(long, 6), "绝不！");
    assert.equal(long.sentences.map((s) => long.text.slice(s.start, s.end)).join(""), long.text);
    assert.deepEqual(long.noteRefs, [{ marker: "[1]", start: long.text.indexOf("[1]"), end: long.text.indexOf("[1]") + 3, note: "sample:d03.p1" }]);
    assert.deepEqual(byId["sample:d03.p1"].noteFor, ["sample:d02.p4"]);
    assert.equal(sentence(byId["sample:d03.p1"], 1), "[1]此语出自一句古老格言。——译者注");
    assert.deepEqual(byId["sample:d02.p5"].noteRefs.map((r) => [r.marker, r.note]), [["*", "sample:d03.p2"]]);

    // 哈希：原文件、成员文件、段落文字、其余产物
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const epubBytes = readFileSync(EPUB);
    assert.equal(manifest.file.sha256, sha256(epubBytes));
    assert.deepEqual(readFileSync(join(dir, "original.epub")), epubBytes);
    assert.deepEqual(manifest.members.map((m) => m.path), ["OEBPS/text/ch1.xhtml", "OEBPS/text/notes.xhtml"]);
    assert.ok(manifest.members.every((m) => /^[0-9a-f]{64}$/.test(m.sha256)));
    assert.equal(manifest.outputs.paragraphs, sha256(readFileSync(join(dir, "paragraphs.jsonl"))));
    assert.equal(manifest.outputs.landmarks, sha256(readFileSync(join(dir, "landmarks.json"))));
    assert.equal(manifest.outputs.normalizationLog, sha256(readFileSync(join(dir, "normalization-log.jsonl"))));
    assert.ok(paragraphs.every((p) => p.textSha256 === sha256(p.text)));
    assert.deepEqual(manifest.work, { title: "论尺度", author: "范例思", translator: "某译者", edition: null });
    assert.deepEqual(manifest.range, { from: "A．质", to: "§ 2", fromLandmark: "sample:d02.h2", toLandmark: "sample:d02.h4" });
    assert.deepEqual(manifest.counts, { paragraphs: 8, inRange: 6, notes: 2, sentences: 17, normalized: 2 });

    const workdir = JSON.parse(readFileSync(join(wd, "workdir.json"), "utf8"));
    assert.equal(workdir.interpreter, "范例思");
    assert.deepEqual(workdir.sources, [{ id: "sample", title: "论尺度", fileSha256: manifest.file.sha256 }]);
    assert.match(readFileSync(join(dir, "reading.md"), "utf8"), /### sample:d02\.p4 · §2 · 附释一\n\n⟨1⟩\*\*附释一：\*\*/);
  }));

test("re-running freeze is byte-identical, and ids do not depend on the range or the workdir", () =>
  withWorkdir((wd) => {
    const args = ["--id", "sample", ...BOOK, "--from", "A．质", "--to", "§ 2"];
    freezeOk(EPUB, "--workdir", join(wd, "a"), ...args);
    const first = snapshot(join(wd, "a", "sources", "sample"));
    assert.equal(freezeOk(EPUB, "--workdir", join(wd, "a"), ...args).status, "unchanged");
    assert.deepEqual(snapshot(join(wd, "a", "sources", "sample")), first);

    // 另一工作目录、经由不同路径读取同一文件：逐字节一致
    const elsewhere = join(wd, "elsewhere", "sample-book.epub");
    cpSync(EPUB, elsewhere);
    freezeOk(elsewhere, "--workdir", join(wd, "b"), ...args);
    assert.deepEqual(snapshot(join(wd, "b", "sources", "sample")), first);

    // 整本书冻结：同一段落的 ID、文字与句子不变
    freezeOk(EPUB, "--workdir", join(wd, "c"), "--id", "sample", ...BOOK);
    const narrow = rows(join(wd, "a", "sources", "sample", "paragraphs.jsonl")).filter((p) => p.inRange);
    const whole = Object.fromEntries(rows(join(wd, "c", "sources", "sample", "paragraphs.jsonl")).map((p) => [p.id, p]));
    for (const p of narrow) {
      assert.equal(whole[p.id]?.text, p.text, p.id);
      assert.deepEqual(whole[p.id].sentences, p.sentences);
    }
    assert.equal(whole["sample:d02.p7"].text, "量是被扬弃了的质。");
    assert.equal(whole["sample:d02.p7"].chapterPath.at(-1), "B．量");
  }));

test("TXT freeze joins hard-wrapped lines, keeps ** emphasis and sticky vs. one-off layers", () =>
  withWorkdir((wd) => {
    freezeOk(TXT, "--workdir", wd, "--id", "sample-txt", ...BOOK);
    const dir = join(wd, "sources", "sample-txt");
    const paragraphs = rows(join(dir, "paragraphs.jsonl"));
    assert.deepEqual(
      paragraphs.map((p) => [p.id, p.section, p.layerLabel]),
      [
        ["sample-txt:t.p1", "§1", "正文"],
        ["sample-txt:t.p2", "§1", "说明"],
        ["sample-txt:t.p3", "§1", "说明"],
        ["sample-txt:t.p4", "§2", "附释一"],
        ["sample-txt:t.p5", "§2", "译注"],
        ["sample-txt:t.p6", "§2", "附释一"],
        ["sample-txt:t.p7", "§2", "附释二"],
        ["sample-txt:t.p8", "§3", "正文"],
      ],
    );
    const [p1, p2, , p4, , p6] = paragraphs;
    assert.equal(p1.text, "存在是直接的规定性。它不是别的东西，而只是它自己。");
    assert.deepEqual(spans(p1), [["直接的", "strong"]]);
    assert.deepEqual(spans(p2), [["开端", "strong"]]);
    assert.deepEqual(p1.locator, { file: "sample-book.txt", anchor: null, lines: [7, 8] });
    assert.equal(p4.sentences.length, 8);
    assert.equal(sentence(p4, 3), "正如人们常说的那样，“开端是最困难的。”[1]");
    assert.match(p6.text, /星号\*单独出现时原样保留/);
    assert.deepEqual(paragraphs.at(-1).chapterPath, ["第一篇　存在", "B．量"]);

    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    assert.equal(manifest.file.sha256, sha256(readFileSync(TXT)));
    assert.equal(manifest.file.format, "txt");
    assert.deepEqual(manifest.members, []);
    const log = rows(join(dir, "normalization-log.jsonl"));
    assert.deepEqual(log[0].rules, ["txt-emphasis-markup", "trim-paragraph-boundary", "join-wrapped-cjk-lines"]);
    assert.equal(log[0].before, "　　存在是**直接的**规定性。它不是别的东西，\n而只是它自己。");
  }));

test("Markdown freeze maps strong and emphasis; --from alone selects one chapter", () =>
  withWorkdir((wd) => {
    freezeOk(MD, "--workdir", wd, "--id", "sample-md", ...BOOK, "--from", "A．质");
    const paragraphs = rows(join(wd, "sources", "sample-md", "paragraphs.jsonl"));
    assert.deepEqual(paragraphs.map((p) => [p.id, p.layer]), [["sample-md:t.p1", "正文"], ["sample-md:t.p2", "说明"]]);
    assert.deepEqual(spans(paragraphs[0]), [["直接的", "strong"], ["它自己", "em"]]);
  }));

test("freeze refuses silent replacement, mixed interpreters, pseudo-interpreters and unknown ranges", () =>
  withWorkdir((wd) => {
    freezeOk(TXT, "--workdir", wd, "--id", "book", ...BOOK);
    const edited = join(wd, "edited.txt");
    writeFileSync(edited, readFileSync(TXT, "utf8").replace("量是被扬弃了的质。", "量是被扬弃了的质，已改。"));

    const changed = pipeline("freeze", edited, "--workdir", wd, "--id", "book", ...BOOK);
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /FROZEN_SOURCE_CHANGED/);
    assert.equal(freezeOk(edited, "--workdir", wd, "--id", "book", ...BOOK, "--force").status, "replaced");
    assert.match(readFileSync(join(wd, "sources", "book", "paragraphs.jsonl"), "utf8"), /已改/);

    // 第二本书可并入同一工作目录，但必须是同一位诠释者
    freezeOk(MD, "--workdir", wd, "--id", "book-2", ...BOOK);
    const workdir = JSON.parse(readFileSync(join(wd, "workdir.json"), "utf8"));
    assert.deepEqual(workdir.sources.map((s) => s.id), ["book", "book-2"]);
    const other = pipeline("freeze", MD, "--workdir", wd, "--id", "book-3", "--title", "别书", "--author", "另一人");
    assert.equal(other.status, 1);
    assert.match(other.stderr, /WORKDIR_INTERPRETER/);

    const board = pipeline("freeze", MD, "--workdir", join(wd, "x"), "--id", "x", "--title", "说明集", "--author", "编委会");
    assert.equal(board.status, 1);
    assert.match(board.stderr, /FREEZE_PSEUDO_INTERPRETER/);

    const missing = pipeline("freeze", TXT, "--workdir", join(wd, "y"), "--id", "y", ...BOOK, "--from", "C．度");
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /FREEZE_RANGE_NOT_FOUND[\s\S]*A．质/);

    const gbk = join(wd, "gbk.txt");
    writeFileSync(gbk, Buffer.from([0xb4, 0xe6, 0xd4, 0xda, 0x0a]));
    const encoding = pipeline("freeze", gbk, "--workdir", join(wd, "z"), "--id", "z", ...BOOK);
    assert.equal(encoding.status, 1);
    assert.match(encoding.stderr, /TEXT_ENCODING/);

    const scan = join(wd, "scan.pdf");
    writeFileSync(scan, "%PDF-1.4");
    const pdf = pipeline("freeze", scan, "--workdir", join(wd, "p"), "--id", "p", ...BOOK);
    assert.equal(pdf.status, 1);
    assert.match(pdf.stderr, /FREEZE_FORMAT/);
  }));

test("frozen artifacts can be re-verified against the stored original", () =>
  withWorkdir((wd) => {
    freezeOk(EPUB, "--workdir", wd, "--id", "sample", ...BOOK, "--from", "A．质", "--to", "§ 2");
    const verify = () => {
      const run = spawnSync(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e",
          `import { verifyFrozenSource } from ${JSON.stringify(join(root, "scripts/book-pipeline/freeze.ts"))};
           console.log(JSON.stringify(verifyFrozenSource(process.argv[1], "sample")));`, wd],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(run.status, 0, run.stderr);
      return JSON.parse(run.stdout);
    };
    assert.deepEqual(verify(), { ok: true, mismatched: [] });
    const path = join(wd, "sources", "sample", "paragraphs.jsonl");
    writeFileSync(path, readFileSync(path, "utf8").replace("绝不！", "绝不。"));
    assert.deepEqual(verify(), { ok: false, mismatched: ["paragraphs.jsonl"] });
  }));

test("--toc lists landmarks without writing, and later commands are explicit stubs", () => {
  const toc = pipeline("freeze", EPUB, "--toc");
  assert.equal(toc.status, 0, toc.stderr);
  assert.match(toc.stdout, /d02\.h2 {2}A．质/);
  assert.match(toc.stdout, /d02\.h4 {2}§2/);
  for (const command of ["incremental"]) {
    const run = pipeline(command);
    assert.equal(run.status, 2, command);
    assert.match(run.stderr, /NOT_IMPLEMENTED/);
  }
  assert.equal(pipeline("bogus").status, 2);
});
