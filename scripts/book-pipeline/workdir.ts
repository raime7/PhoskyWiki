// 工作目录布局与读写工具。各命令只通过这里取路径，不自行拼接文件名。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { ConceptKey, SourceId } from "./types";

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function workdirLayout(root: string) {
  const base = resolve(root);
  const source = (id: SourceId) => {
    assertId(id, "sourceId");
    const dir = join(base, "sources", id);
    return {
      dir,
      /** 原文件逐字节副本（版权材料，只留本地）；扩展名随格式 */
      original: (ext: string) => join(dir, `original.${ext}`),
      manifest: join(dir, "manifest.json"),
      paragraphs: join(dir, "paragraphs.jsonl"),
      landmarks: join(dir, "landmarks.json"),
      normalizationLog: join(dir, "normalization-log.jsonl"),
      /** 带段落与句子编号的阅读稿，供会话引用 */
      reading: join(dir, "reading.md"),
    };
  };
  const perspective = (key: ConceptKey) => {
    assertId(key, "conceptKey");
    const dir = join(base, "perspectives", key);
    return {
      dir,
      claimMap: join(dir, "claim-map.json"),
      /** 润色前的论点映射副本（润色子代理先存这一份，供会话比对润色只改了文字） */
      claimMapPrePolish: join(dir, "claim-map.pre-polish.json"),
      markdown: join(dir, "perspective.md"),
      assembled: join(dir, "assembled.json"),
      review: join(dir, "review.json"),
      validation: join(dir, "validation.json"),
      overrides: join(dir, "overrides.json"),
      base: join(dir, "base.json"),
      locks: join(dir, "locks.json"),
    };
  };
  return {
    root: base,
    manifest: join(base, "workdir.json"),
    source,
    candidates: {
      dir: join(base, "candidates"),
      session: join(base, "candidates", "session-candidates.json"),
      siteExport: join(base, "candidates", "site-terms.json"),
      list: join(base, "candidates", "candidates.json"),
      confirmation: join(base, "candidates", "confirmation.json"),
    },
    style: {
      dir: join(base, "style"),
      /** 文风档案（会话环节，Markdown；小节见 types.ts 的 STYLE_PROFILE_SECTIONS） */
      profile: join(base, "style", "profile.md"),
    },
    perspective,
    submit: {
      dir: join(base, "submit"),
      plan: join(base, "submit", "plan.json"),
      ledger: join(base, "submit", "ledger.jsonl"),
    },
  };
}

export type WorkdirLayout = ReturnType<typeof workdirLayout>;

function assertId(value: string, field: string): void {
  if (!ID_PATTERN.test(value)) throw new Error(`INVALID_ID: ${field} must match ${ID_PATTERN}: ${value}`);
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 稳定 JSON：两格缩进、末尾换行；键序即对象构造顺序。 */
export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export function jsonlText(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row) + "\n").join("");
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

export function writeText(path: string, text: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function fileEquals(path: string, content: string | Uint8Array): boolean {
  if (!existsSync(path)) return false;
  const current = readFileSync(path);
  return Buffer.compare(current, Buffer.from(content)) === 0;
}
