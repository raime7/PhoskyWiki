// EPUB 读取：container.xml → OPF → 书脊顺序的 XHTML 文档 → 原始块。
// 只读文字层；图片、ruby 注音（rt/rp）与导航（nav）不进入段落。

import { posix } from "node:path";

import type { EmphasisKind, FreezeRules } from "../types";
import { sha256 } from "../workdir";
import type { RawBlock, RawBook, RawEmphasis, RawLink, RawUnit } from "./raw";
import { classList, epubTypes, findFirst, parseXhtml, walkElements, type XmlElement } from "./xhtml";
import { readZip } from "./zip";

const SKIP = new Set(["head", "script", "style", "nav", "rt", "rp", "img", "svg", "math", "object", "video", "audio"]);
const HEADING = /^h([1-6])$/;
const BLOCK = new Set([
  "p", "div", "li", "dd", "dt", "pre", "blockquote", "figcaption", "td", "th", "caption",
  "section", "article", "aside", "header", "footer", "main", "figure",
  "ul", "ol", "dl", "table", "thead", "tbody", "tr", "body",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr",
]);
const NOTE_TYPES = new Set(["footnote", "endnote", "rearnote", "note", "footnotes", "endnotes", "rearnotes"]);
const EMPHASIS_TAGS: Record<string, EmphasisKind> = { em: "em", i: "em", strong: "strong", b: "strong" };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function resolveHref(from: string, href: string): string {
  const clean = decodeURIComponent(href.split("#")[0]);
  return clean ? posix.normalize(posix.join(posix.dirname(from), clean)) : from;
}

export function readEpub(bytes: Buffer, _fileName: string, rules: FreezeRules): RawBook {
  const zip = readZip(bytes);
  const container = zip.get("META-INF/container.xml");
  if (!container) throw new Error("EPUB_STRUCTURE: META-INF/container.xml missing");
  const rootfile = findFirst(parseXhtml(container.toString("utf8")), "rootfile");
  const opfPath = rootfile?.attrs["full-path"];
  if (!opfPath || !zip.has(opfPath)) throw new Error("EPUB_STRUCTURE: OPF package document missing");
  const opf = parseXhtml(zip.get(opfPath)!.toString("utf8"));

  const manifest = new Map<string, { path: string; type: string }>();
  for (const item of walkElements(opf)) {
    if (item.name === "item" && item.attrs.id && item.attrs.href) {
      manifest.set(item.attrs.id, { path: resolveHref(opfPath, item.attrs.href), type: item.attrs["media-type"] ?? "" });
    }
  }
  const spinePaths: string[] = [];
  // linear="no" 的书脊项（注释、附录等辅助文档）保留书脊序号，但不进入整书范围
  const auxiliary = new Set<string>();
  for (const ref of walkElements(opf)) {
    if (ref.name !== "itemref") continue;
    const item = manifest.get(ref.attrs.idref ?? "");
    if (!item) throw new Error(`EPUB_STRUCTURE: spine references unknown item ${ref.attrs.idref}`);
    if (!spinePaths.includes(item.path)) spinePaths.push(item.path);
    if (ref.attrs.linear === "no") auxiliary.add(item.path);
  }
  if (spinePaths.length === 0) throw new Error("EPUB_STRUCTURE: empty spine");
  const extraPaths = [...manifest.values()]
    .filter((item) => item.type === "application/xhtml+xml" && !spinePaths.includes(item.path))
    .map((item) => item.path);

  const units: RawUnit[] = [];
  const add = (path: string, key: string, inSpine: boolean) => {
    const data = zip.get(path);
    if (!data) throw new Error(`EPUB_STRUCTURE: missing member ${path}`);
    const document = parseXhtml(data.toString("utf8"));
    const body = findFirst(document, "body");
    if (!body) throw new Error(`EPUB_STRUCTURE: ${path} has no body`);
    units.push({ key, inSpine, member: { path, sha256: sha256(data) }, blocks: new DocumentWalker(path, rules).run(body) });
  };
  spinePaths.forEach((path, i) => add(path, `d${pad(i + 1)}`, !auxiliary.has(path)));
  extraPaths.forEach((path, i) => add(path, `m${pad(i + 1)}`, false));
  return { format: "epub", units };
}

interface Inline {
  raw: string;
  emphasis: RawEmphasis[];
  links: RawLink[];
  ids: string[];
}

class DocumentWalker {
  private blocks: RawBlock[] = [];
  private pendingIds: string[] = [];
  private lastAnchor: string | null = null;
  private loose: Inline | null = null;
  private looseNote = false;

  constructor(
    private readonly path: string,
    private readonly rules: FreezeRules,
  ) {}

  run(body: XmlElement): RawBlock[] {
    this.container(body, false);
    this.flushLoose();
    return this.blocks;
  }

  private key(id: string): string {
    return `${this.path}#${id}`;
  }

  private isNoteContainer(element: XmlElement): boolean {
    return (
      epubTypes(element).some((type) => NOTE_TYPES.has(type)) ||
      classList(element).some((cls) => this.rules.noteContainerClasses.includes(cls))
    );
  }

  private container(element: XmlElement, note: boolean): void {
    for (const child of element.children) {
      if (child.type === "text") {
        if (child.value.trim() || this.loose) this.appendLoose(child.value, note);
        continue;
      }
      if (SKIP.has(child.name) || epubTypes(child).includes("pagebreak")) continue;
      const heading = HEADING.exec(child.name);
      const childNote = note || this.isNoteContainer(child);
      if (heading) {
        this.flushLoose();
        this.emit(child, "heading", Number(heading[1]), childNote);
      } else if (child.name === "hr") {
        this.flushLoose();
      } else if (BLOCK.has(child.name)) {
        this.flushLoose();
        if (hasBlockChildren(child)) {
          if (child.attrs.id) {
            this.pendingIds.push(this.key(child.attrs.id));
            this.lastAnchor = child.attrs.id;
          }
          this.container(child, childNote);
          this.flushLoose();
        } else {
          this.emit(child, "paragraph", 0, childNote);
        }
      } else {
        // 块级容器中的游离行内内容：并成一个隐式段落
        if (!this.loose) this.loose = { raw: "", emphasis: [], links: [], ids: [] };
        this.looseNote = this.looseNote || childNote;
        this.inline(child, this.loose);
      }
    }
  }

  private appendLoose(text: string, note: boolean): void {
    if (!this.loose) this.loose = { raw: "", emphasis: [], links: [], ids: [] };
    this.looseNote = this.looseNote || note;
    this.loose.raw += text;
  }

  private flushLoose(): void {
    const loose = this.loose;
    this.loose = null;
    const note = this.looseNote;
    this.looseNote = false;
    if (!loose || !loose.raw.trim()) return;
    this.push(loose, "paragraph", 0, note, null);
  }

  private emit(element: XmlElement, kind: RawBlock["kind"], level: number, note: boolean): void {
    const inline: Inline = { raw: "", emphasis: [], links: [], ids: [] };
    if (element.attrs.id) inline.ids.push(this.key(element.attrs.id));
    for (const child of element.children) {
      if (child.type === "text") inline.raw += child.value;
      else this.inline(child, inline);
    }
    this.push(inline, kind, level, note, element.attrs.id ?? null);
  }

  private push(inline: Inline, kind: RawBlock["kind"], level: number, note: boolean, ownId: string | null): void {
    const ids = [...this.pendingIds, ...inline.ids];
    this.pendingIds = [];
    const anchor = ownId ?? inline.ids[0]?.split("#")[1] ?? this.lastAnchor;
    if (ownId) this.lastAnchor = ownId;
    this.blocks.push({
      kind,
      level,
      original: inline.raw,
      raw: inline.raw,
      emphasis: inline.emphasis,
      links: inline.links,
      ids,
      noteContainer: note,
      locator: { file: this.path, anchor, lines: null },
      readerRules: [],
    });
  }

  private inline(element: XmlElement, into: Inline): void {
    if (SKIP.has(element.name)) return;
    if (element.name === "br") {
      into.raw += "\n";
      return;
    }
    if (element.attrs.id) into.ids.push(this.key(element.attrs.id));
    const start = into.raw.length;
    for (const child of element.children) {
      if (child.type === "text") into.raw += child.value;
      else this.inline(child, into);
    }
    const end = into.raw.length;
    if (end === start) return;
    const tagKind = EMPHASIS_TAGS[element.name];
    if (tagKind) into.emphasis.push({ start, end, kind: tagKind, via: element.name });
    for (const cls of classList(element)) {
      const kind = this.rules.emphasisClasses[cls];
      if (kind && !tagKind) {
        into.emphasis.push({ start, end, kind, via: `${element.name}.${cls}` });
        break;
      }
    }
    const href = element.name === "a" ? element.attrs.href : undefined;
    if (href && href.includes("#") && !/^[a-z]+:/i.test(href)) {
      const target = `${resolveHref(this.path, href)}#${decodeURIComponent(href.split("#")[1])}`;
      into.links.push({ start, end, target, noteref: epubTypes(element).includes("noteref") });
    }
  }
}

function hasBlockChildren(element: XmlElement): boolean {
  for (const child of element.children) {
    if (child.type !== "element" || SKIP.has(child.name)) continue;
    if (BLOCK.has(child.name) || hasBlockChildren(child)) return true;
  }
  return false;
}
