// 文字规范化与切句。只做有记录的排版清理：不做 Unicode 归一化，不改标点与字形。

import type { FrozenSentence, NoteRef, NormalizationRule } from "../types";

const EDGE_SPACE = /[\s 　]/;
const ASCII_SPACE = /[ \t\r\n\f]/;
const INVISIBLE = new Set(["​", "⁠", "﻿", "­"]);

/** 中文语境字符：汉字、CJK 标点、全角形式、中文引号与破折号省略号。 */
export function isCjkContext(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x2018 && code <= 0x201f) ||
    code === 0x2014 ||
    code === 0x2026 ||
    code === 0x00b7
  );
}

export interface Normalized {
  text: string;
  /** 原始下标 → 规范化后下标（长度 raw.length + 1） */
  map: number[];
  rules: NormalizationRule[];
}

export function normalizeText(raw: string): Normalized {
  const rules = new Set<NormalizationRule>();
  let lo = 0;
  let hi = raw.length;
  while (lo < hi && (EDGE_SPACE.test(raw[lo]) || INVISIBLE.has(raw[lo]))) lo++;
  while (hi > lo && (EDGE_SPACE.test(raw[hi - 1]) || INVISIBLE.has(raw[hi - 1]))) hi--;
  if (lo > 0 || hi < raw.length) rules.add("trim-paragraph-boundary");
  const map = new Array<number>(raw.length + 1).fill(0);
  let text = "";
  for (let i = 0; i < lo; i++) map[i] = 0;
  let i = lo;
  while (i < hi) {
    const ch = raw[i];
    if (INVISIBLE.has(ch)) {
      map[i] = text.length;
      rules.add("remove-invisible-characters");
      i++;
      continue;
    }
    if (ASCII_SPACE.test(ch)) {
      let j = i;
      while (j < hi && ASCII_SPACE.test(raw[j])) j++;
      const run = raw.slice(i, j);
      for (let k = i; k < j; k++) map[k] = text.length;
      if (run === " ") {
        text += " ";
      } else if (/[\r\n]/.test(run) && isCjkContext(text[text.length - 1]) && isCjkContext(raw[j])) {
        rules.add("join-wrapped-cjk-lines");
      } else {
        text += " ";
        rules.add("collapse-whitespace");
      }
      i = j;
      continue;
    }
    map[i] = text.length;
    text += ch;
    i++;
  }
  for (let k = hi; k <= raw.length; k++) map[k] = text.length;
  return { text, map, rules: [...rules] };
}

const TERMINATORS = new Set(["。", "！", "？", "!", "?"]);
const CLOSERS = new Set(["”", "’", "」", "』", "）", ")", "】", "》", "〉", "］", "]", '"', "'"]);

/** 未链接的注号（TXT/MD 中常见）：紧跟句末时归入本句。 */
const PLAIN_MARKER = /^(?:[[［〔]\d{1,3}[\]］〕]|[①-⑳])/;

function isTerminator(text: string, i: number): boolean {
  if (TERMINATORS.has(text[i])) return true;
  // 西文句点：其后为空白或段尾，且前一字符是字母
  return text[i] === "." && /[A-Za-z]/.test(text[i - 1] ?? "") && (i + 1 === text.length || /\s/.test(text[i + 1]));
}

/** 切句：句末标点连同其后的闭合引号括号、紧随的注号一并归入本句。 */
export function splitSentences(paragraphId: string, text: string, noteRefs: NoteRef[]): FrozenSentence[] {
  const refsAt = new Map(noteRefs.map((ref) => [ref.start, ref.end]));
  const spans: [number, number][] = [];
  let start = 0;
  const skipSpace = (from: number) => {
    let k = from;
    while (k < text.length && /\s/.test(text[k])) k++;
    return k;
  };
  start = skipSpace(0);
  let i = start;
  while (i < text.length) {
    if (!isTerminator(text, i)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < text.length && isTerminator(text, j)) j++;
    for (;;) {
      const marker = refsAt.has(j) ? null : PLAIN_MARKER.exec(text.slice(j, j + 8));
      if (j < text.length && CLOSERS.has(text[j])) j++;
      else if (refsAt.has(j)) j = refsAt.get(j)!;
      else if (marker) j += marker[0].length;
      else break;
    }
    const next = skipSpace(j);
    if (next < text.length) {
      spans.push([start, j]);
      start = next;
    }
    i = next > j ? next : j;
  }
  let end = text.length;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end > start) spans.push([start, end]);
  // 段末署名（如「——译者注」）归入前一句
  if (spans.length > 1 && text.startsWith("——", spans[spans.length - 1][0])) {
    const [, tail] = spans.pop()!;
    spans[spans.length - 1][1] = tail;
  }
  return spans.map(([s, e], index) => ({ id: `${paragraphId}.s${index + 1}`, n: index + 1, start: s, end: e }));
}
