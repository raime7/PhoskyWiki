// TXT 与 Markdown 读取。两者都只有一个结构单元 `t`。
//
// TXT 约定：空行或行首缩进（全角空格、两个以上空格或制表符）开始新段，其余行是上一段的硬换行续行；
// `#` 行与 rules.txtHeadings 命中的短行是标题；整行命中节号规则的行单独成块；
// 成对的 `**…**` 视为强调（去掉标记并记入规范化日志），不成对的星号原样保留。
// TXT 不识别注号与注释链接；注释段落靠层次规则（如 〔译注〕）标出。

import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Node, Parent } from "unist";

import type { FreezeRules } from "../types";
import type { RawBlock, RawBook, RawEmphasis } from "./raw";

export function decodeUtf8(bytes: Buffer, fileName: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    throw new Error(`TEXT_ENCODING: ${fileName} is not valid UTF-8; convert it first (e.g. iconv -f GB18030 -t UTF-8)`);
  }
}

function heading(line: string, rules: FreezeRules): { level: number; text: string } | null {
  const hashes = /^(#{1,6})[ \t　]+(.+?)[ \t#]*$/.exec(line.trim());
  if (hashes) return { level: hashes[1].length, text: hashes[2] };
  const trimmed = line.trim();
  for (const rule of rules.txtHeadings) {
    if (trimmed.length <= rule.maxLength && new RegExp(rule.pattern).test(trimmed)) return { level: rule.level, text: trimmed };
  }
  return null;
}

function emptyBlock(kind: RawBlock["kind"], level: number, text: string, file: string, lines: [number, number]): RawBlock {
  return {
    kind,
    level,
    original: text,
    raw: text,
    emphasis: [],
    links: [],
    ids: [],
    noteContainer: false,
    locator: { file, anchor: null, lines },
    readerRules: [],
  };
}

/** 去掉成对 `**` 并记录强调区间；星号数为奇数时整段原样保留。 */
function stripStars(block: RawBlock): void {
  const parts = block.original.split("**");
  if (parts.length < 3 || parts.length % 2 === 0) return;
  let raw = "";
  const emphasis: RawEmphasis[] = [];
  parts.forEach((part, i) => {
    const start = raw.length;
    raw += part;
    if (i % 2 === 1 && part) emphasis.push({ start, end: raw.length, kind: "strong", via: "**" });
  });
  block.raw = raw;
  block.emphasis = emphasis;
  block.readerRules.push("txt-emphasis-markup");
}

export function readTxt(bytes: Buffer, fileName: string, rules: FreezeRules): RawBook {
  const lines = decodeUtf8(bytes, fileName).split(/\r\n|\n|\r/);
  const blocks: RawBlock[] = [];
  const markers = rules.sectionMarkers.map((rule) => new RegExp(rule.pattern));
  let current: { lines: string[]; first: number } | null = null;
  const flush = (last: number) => {
    if (!current) return;
    const block = emptyBlock("paragraph", 0, current.lines.join("\n"), fileName, [current.first, last]);
    stripStars(block);
    blocks.push(block);
    current = null;
  };
  lines.forEach((line, index) => {
    const n = index + 1;
    if (!line.trim()) return flush(n - 1);
    const title = heading(line, rules);
    if (title) {
      flush(n - 1);
      blocks.push(emptyBlock("heading", title.level, title.text, fileName, [n, n]));
      return;
    }
    if (markers.some((marker) => marker.test(line.trim()))) {
      flush(n - 1);
      blocks.push(emptyBlock("paragraph", 0, line, fileName, [n, n]));
      return;
    }
    if (current && /^(　|[ ]{2,}|\t)/.test(line)) flush(n - 1);
    if (current) current.lines.push(line);
    else current = { lines: [line], first: n };
  });
  flush(lines.length);
  return { format: "txt", units: [{ key: "t", inSpine: true, member: null, blocks }] };
}

interface MdNode extends Node {
  value?: string;
  depth?: number;
  children?: MdNode[];
}

export function readMarkdown(bytes: Buffer, fileName: string): RawBook {
  const source = decodeUtf8(bytes, fileName);
  const tree = unified().use(remarkParse).parse(source) as MdNode;
  const blocks: RawBlock[] = [];
  const lines = (node: MdNode): [number, number] => [node.position?.start.line ?? 0, node.position?.end.line ?? 0];
  const original = (node: MdNode) => source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);

  const collect = (node: MdNode, block: RawBlock) => {
    if (node.type === "text" || node.type === "inlineCode") {
      block.raw += node.value ?? "";
      return;
    }
    if (node.type === "break") {
      block.raw += "\n";
      return;
    }
    if (node.type === "html" || node.type === "image" || node.type === "imageReference") return;
    const start = block.raw.length;
    for (const child of node.children ?? []) collect(child, block);
    if ((node.type === "emphasis" || node.type === "strong") && block.raw.length > start) {
      block.emphasis.push({
        start,
        end: block.raw.length,
        kind: node.type === "strong" ? "strong" : "em",
        via: node.type === "strong" ? "md.strong" : "md.emphasis",
      });
    }
  };

  const visit = (node: MdNode) => {
    if (node.type === "heading" || node.type === "paragraph") {
      const block = emptyBlock(node.type, node.depth ?? 0, "", fileName, lines(node));
      block.original = original(node);
      for (const child of node.children ?? []) collect(child, block);
      block.emphasis.sort((a, b) => a.start - b.start || a.end - b.end);
      blocks.push(block);
    } else if (node.type === "code") {
      const block = emptyBlock("paragraph", 0, node.value ?? "", fileName, lines(node));
      block.original = original(node);
      blocks.push(block);
    } else if ((node as Parent).children) {
      for (const child of node.children ?? []) visit(child);
    }
  };
  visit(tree);
  return { format: "md", units: [{ key: "t", inSpine: true, member: null, blocks }] };
}
