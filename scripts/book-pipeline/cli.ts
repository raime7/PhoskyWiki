// 书籍流水线 CLI（#105）：所有命令作用于同一个工作目录，可单独重跑。
// 运行：pnpm book-pipeline <command> [...]（= node --conditions=react-server --import tsx scripts/book-pipeline/cli.ts）
// 退出码：0 成功；1 运行错误；2 用法错误。

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { assemble } from "./assemble";
import { validate } from "./validate";
import { writeCandidateList, writeConfirmation } from "./candidates";
import { exportSite } from "./export-site";
import { DEFAULT_RULES, detectFormat, freezeBook, writeFrozenSource } from "./freeze";
import { incremental, type RevisionExport } from "./incremental";
import { submit } from "./submit";
import type { FreezeRules } from "./types";

class UsageError extends Error {}

const USAGE = `用法：book-pipeline <command> [options]

  freeze <file> --workdir <dir> --id <sourceId> --title <书名> --author <著者=诠释者>
         [--translator <译者>] [--edition <译本说明>] [--from <标题|节号|landmark id>] [--to <...>]
         [--rules <rules.json>] [--format epub|txt|md] [--force]
  freeze <file> --toc [--rules <rules.json>]     只列出标题与节号（不写文件），用于选择 --from/--to
  rules                                          打印默认冻结规则（可另存为 --rules 起点）

  export-site --workdir <dir> --origin <url>     经站点公开只读接口导出站上词条、诠释者与视角 → candidates/site-terms.json
  export-site --workdir <dir> --origin <url> --key <key> ... --ai-user <AI 编者用户 id>
                                                 导出已有视角的 head 与上一次 AI 修订 → perspectives/<key>/base.json（供 incremental）
  candidates --workdir <dir>                     读 candidates/session-candidates.json 与 site-terms.json，生成 candidates.json
  confirm --workdir <dir> --by <站长名> (--all | --keys a,b)   确认候选清单（清单变动后确认即失效）
  assemble --workdir <dir> [--key <key> ...] [--rewrite <key> ...]
                                                 按模板把已确认概念的 claim-map.json 组装为 perspective.md 与 assembled.json
                                                 （缺省 = 全部已确认且已有论点映射的新视角；清单未确认即拒绝）。
                                                 已有视角归 incremental：缺省跳过，--key 点名即拒绝；--rewrite 才整篇重写为以 head 为 base 的编辑

  validate --workdir <dir> [--key <key> ...]     确定性校验已组装的视角，写 perspectives/<key>/validation.json
                                                 （有未放行的发现项时退出码 1，报告照常写出）

  submit --workdir <dir> [--key <key> ...] [--origin <url>] [--send] [--rate <每分钟次数，默认 60>]
         [--resubmit <opKey> ...] [--reconcile <opKey[=pageId]> ...]
                                                 默认试运行：校验门禁后写 submit/plan.json 并列出将发出的请求（账本里已完成的略去）。
                                                 --send 才真正发出（环境变量 BOOK_PIPELINE_EMAIL / BOOK_PIPELINE_PASSWORD，须为 editor 账号）；
                                                 第一阶段（诠释者、词条）被受理后用 --reconcile opKey=pageId 记账，再 --send 发第二阶段

  incremental --workdir <dir> --key <key>
         [--head <head.md> --head-revision <id> (--last-ai <ai.md> --last-ai-revision <id> | --no-last-ai) [--page <id>]]
         [--rederive-footer]
                                                 增量更新现有视角：导出的 head 修订写入 base.json，人工改过的块写入 locks.json；
                                                 已有 claim-map.json（增量论点映射）时并入新材料，写出以 head 为 base 的编辑稿
                                                 （perspective.md + assembled.json），否则输出供会话起草的骨架。省略 --head 则沿用 base.json。
                                                 head 的资料说明被人工改过时拒绝，--rederive-footer 确认按引用重新推导

工作目录布局见 scripts/book-pipeline/README.md。`;

function loadRules(path: string | undefined): Partial<FreezeRules> | undefined {
  if (!path) return undefined;
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UsageError("--rules must be a JSON object");
  return value as Partial<FreezeRules>;
}

function freeze(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      workdir: { type: "string" },
      id: { type: "string" },
      title: { type: "string" },
      author: { type: "string" },
      translator: { type: "string" },
      edition: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      rules: { type: "string" },
      format: { type: "string" },
      force: { type: "boolean", default: false },
      toc: { type: "boolean", default: false },
    },
  });
  if (positionals.length !== 1) throw new UsageError("freeze takes exactly one source file");
  const file = positionals[0];
  const format = values.format ? (values.format as ReturnType<typeof detectFormat>) : detectFormat(file);
  if (!["epub", "txt", "md"].includes(format)) throw new UsageError("--format must be epub, txt or md");
  const input = {
    bytes: readFileSync(file),
    fileName: file,
    format,
    sourceId: values.id ?? "toc",
    title: values.title ?? (values.toc ? "toc" : ""),
    author: values.author ?? (values.toc ? "toc" : ""),
    translator: values.translator ?? null,
    edition: values.edition ?? null,
    from: values.toc ? null : (values.from ?? null),
    to: values.toc ? null : (values.to ?? null),
    rules: loadRules(values.rules),
  };
  if (values.toc) {
    for (const landmark of freezeBook(input).landmarks) {
      console.log(`${"  ".repeat(Math.min(landmark.level, 7) - 1)}${landmark.id.replace(/^toc:/, "")}  ${landmark.title}`);
    }
    return;
  }
  if (!values.workdir) throw new UsageError("--workdir is required");
  if (!values.id) throw new UsageError("--id is required");
  const result = writeFrozenSource(values.workdir, freezeBook(input), values.force);
  console.log(JSON.stringify({ status: result.status, source: result.manifest.sourceId, dir: result.dir, ...result.manifest.counts }));
}

async function exportSiteCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { workdir: { type: "string" }, origin: { type: "string" }, key: { type: "string", multiple: true }, "ai-user": { type: "string" } },
  });
  if (!values.workdir) throw new UsageError("--workdir is required");
  if (!values.origin) throw new UsageError("--origin is required (the site to read from)");
  if (values.key?.length && !values["ai-user"]) throw new UsageError("--key needs --ai-user <user id of the AI editor account>");
  if (!values.key?.length && values["ai-user"]) throw new UsageError("--ai-user only goes with --key");
  const results = await exportSite({ workdir: values.workdir, origin: values.origin, keys: values.key, aiUser: values["ai-user"] });
  for (const result of results) console.log(JSON.stringify(result));
}

function candidates(args: string[]): void {
  const { values } = parseArgs({ args, options: { workdir: { type: "string" } } });
  if (!values.workdir) throw new UsageError("--workdir is required");
  const { list, changed, confirmationInvalidated } = writeCandidateList(values.workdir);
  console.log(
    JSON.stringify({ status: changed ? "written" : "unchanged", entries: list.entries.length, excluded: list.excluded.length, blocked: list.blocked.length, confirmationInvalidated }),
  );
}

function confirm(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: { workdir: { type: "string" }, by: { type: "string" }, keys: { type: "string" }, all: { type: "boolean", default: false } },
  });
  if (!values.workdir) throw new UsageError("--workdir is required");
  if (!values.by) throw new UsageError("--by is required");
  if (Boolean(values.all) === Boolean(values.keys)) throw new UsageError("give exactly one of --all or --keys a,b,c");
  const result = writeConfirmation(values.workdir, {
    by: values.by,
    all: values.all,
    keys: values.keys?.split(",").map((k) => k.trim()).filter(Boolean),
  });
  console.log(JSON.stringify({ status: "confirmed", confirmed: result.confirmed, candidateListSha256: result.candidateListSha256 }));
}

function assembleCommand(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: { workdir: { type: "string" }, key: { type: "string", multiple: true }, rewrite: { type: "string", multiple: true } },
  });
  if (!values.workdir) throw new UsageError("--workdir is required");
  for (const result of assemble(values.workdir, values.key ?? [], values.rewrite ?? [])) console.log(JSON.stringify(result));
}

async function submitCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      workdir: { type: "string" },
      key: { type: "string", multiple: true },
      origin: { type: "string" },
      send: { type: "boolean", default: false },
      rate: { type: "string" },
      resubmit: { type: "string", multiple: true },
      reconcile: { type: "string", multiple: true },
    },
  });
  if (!values.workdir) throw new UsageError("--workdir is required");
  const rate = values.rate === undefined ? undefined : Number(values.rate);
  if (rate !== undefined && (!Number.isInteger(rate) || rate < 1)) throw new UsageError("--rate must be a positive integer");
  await submit({
    workdir: values.workdir,
    keys: values.key,
    origin: values.origin,
    send: values.send,
    rate,
    resubmit: values.resubmit,
    reconcile: values.reconcile,
  });
}

function incrementalCommand(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      workdir: { type: "string" },
      key: { type: "string" },
      head: { type: "string" },
      "head-revision": { type: "string" },
      "last-ai": { type: "string" },
      "last-ai-revision": { type: "string" },
      "no-last-ai": { type: "boolean", default: false },
      page: { type: "string" },
      "rederive-footer": { type: "boolean", default: false },
    },
  });
  if (!values.workdir) throw new UsageError("--workdir is required");
  if (!values.key) throw new UsageError("--key is required");
  const id = (value: string | undefined, flag: string): number => {
    const n = Number(value);
    if (!value || !Number.isInteger(n) || n < 1) throw new UsageError(`${flag} must be a positive integer`);
    return n;
  };
  const exported = (file: string, revision: string | undefined, flag: string): RevisionExport => ({
    revisionId: id(revision, flag),
    content: readFileSync(file, "utf8"),
  });
  let head: RevisionExport | undefined;
  let lastAi: RevisionExport | null | undefined;
  if (values.head) {
    if (Boolean(values["last-ai"]) === values["no-last-ai"]) throw new UsageError("with --head, give exactly one of --last-ai <file> or --no-last-ai");
    head = exported(values.head, values["head-revision"], "--head-revision");
    lastAi = values["last-ai"] ? exported(values["last-ai"], values["last-ai-revision"], "--last-ai-revision") : null;
  } else if (values["head-revision"] || values["last-ai"] || values["last-ai-revision"] || values["no-last-ai"] || values.page) {
    throw new UsageError("--head-revision, --last-ai, --no-last-ai and --page only go with --head");
  }
  const result = incremental({
    workdir: values.workdir,
    key: values.key,
    head,
    lastAi,
    pageId: values.page === undefined ? undefined : id(values.page, "--page"),
    rederiveFooter: values["rederive-footer"],
  });
  if (result.footerHumanEdits) {
    console.error(`NOTE: ${result.footerHumanEdits} human-edited block(s) in the source notes are re-derived from the citations (--rederive-footer)`);
  }
  console.log(JSON.stringify(result));
}

function validateCommand(args: string[]): boolean {
  const { values } = parseArgs({ args, options: { workdir: { type: "string" }, key: { type: "string", multiple: true } } });
  if (!values.workdir) throw new UsageError("--workdir is required");
  const results = validate(values.workdir, values.key ?? []);
  for (const result of results) console.log(JSON.stringify(result));
  const failed = results.filter((r) => !r.ok).map((r) => r.key);
  if (failed.length) console.error(`VALIDATION_FAILED: ${failed.join(", ")} (see perspectives/<key>/validation.json)`);
  return failed.length === 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      console.log(USAGE);
      return command ? 0 : 2;
    }
    if (command === "freeze") {
      freeze(rest);
      return 0;
    }
    if (command === "export-site") {
      await exportSiteCommand(rest);
      return 0;
    }
    if (command === "candidates") {
      candidates(rest);
      return 0;
    }
    if (command === "confirm") {
      confirm(rest);
      return 0;
    }
    if (command === "assemble") {
      assembleCommand(rest);
      return 0;
    }
    if (command === "validate") return validateCommand(rest) ? 0 : 1;
    if (command === "incremental") {
      incrementalCommand(rest);
      return 0;
    }
    if (command === "submit") {
      await submitCommand(rest);
      return 0;
    }
    if (command === "rules") {
      console.log(JSON.stringify(DEFAULT_RULES, null, 2));
      return 0;
    }
    throw new UsageError(`unknown command "${command}"`);
  } catch (error) {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error(`${(error as Error).message}\n\n${USAGE}`);
      return 2;
    }
    console.error((error as Error).message);
    return 1;
  }
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
