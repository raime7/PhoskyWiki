// 书籍流水线 CLI（#105）：所有命令作用于同一个工作目录，可单独重跑。
// 运行：pnpm book-pipeline <command> [...]（= node --conditions=react-server --import tsx scripts/book-pipeline/cli.ts）
// 退出码：0 成功；1 运行错误；2 用法错误或命令尚未实现。

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { writeCandidateList, writeConfirmation } from "./candidates";
import { DEFAULT_RULES, detectFormat, freezeBook, writeFrozenSource } from "./freeze";
import type { FreezeRules } from "./types";

class UsageError extends Error {}

const USAGE = `用法：book-pipeline <command> [options]

  freeze <file> --workdir <dir> --id <sourceId> --title <书名> --author <著者=诠释者>
         [--translator <译者>] [--edition <译本说明>] [--from <标题|节号|landmark id>] [--to <...>]
         [--rules <rules.json>] [--format epub|txt|md] [--force]
  freeze <file> --toc [--rules <rules.json>]     只列出标题与节号（不写文件），用于选择 --from/--to
  rules                                          打印默认冻结规则（可另存为 --rules 起点）

  candidates --workdir <dir>                     读 candidates/session-candidates.json 与 site-terms.json，生成 candidates.json
  confirm --workdir <dir> --by <站长名> (--all | --keys a,b)   确认候选清单（清单变动后确认即失效）

  后续命令（尚未实现）：
  assemble (#109)   validate (#110)   incremental (#111)   submit (#112)

工作目录布局见 scripts/book-pipeline/README.md。`;

const PENDING: Record<string, string> = {
  assemble: "#109",
  validate: "#110",
  incremental: "#111",
  submit: "#112",
};

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

function candidates(args: string[]): void {
  const { values } = parseArgs({ args, options: { workdir: { type: "string" } } });
  if (!values.workdir) throw new UsageError("--workdir is required");
  const { list, changed, confirmationInvalidated } = writeCandidateList(values.workdir);
  console.log(
    JSON.stringify({ status: changed ? "written" : "unchanged", entries: list.entries.length, excluded: list.excluded.length, confirmationInvalidated }),
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

function main(argv: string[]): number {
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
    if (command === "candidates") {
      candidates(rest);
      return 0;
    }
    if (command === "confirm") {
      confirm(rest);
      return 0;
    }
    if (command === "rules") {
      console.log(JSON.stringify(DEFAULT_RULES, null, 2));
      return 0;
    }
    if (PENDING[command]) {
      console.error(`NOT_IMPLEMENTED: "${command}" is specified in ${PENDING[command]} and not implemented yet`);
      return 2;
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

process.exitCode = main(process.argv.slice(2));
