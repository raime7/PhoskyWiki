// 最小 XHTML 解析器：EPUB 内容文档是 XML，标签结构规整。容忍 HTML 式空元素与多余的闭合标签；
// 未知命名实体直接报错（不静默改字），需要时在 NAMED_ENTITIES 中补充。

export interface XmlElement {
  type: "element";
  /** 小写本地名（去掉命名空间前缀） */
  name: string;
  /** 属性名小写、保留前缀（如 epub:type） */
  attrs: Record<string, string>;
  children: XmlNode[];
}

export interface XmlText {
  type: "text";
  value: string;
}

export type XmlNode = XmlElement | XmlText;

const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "col", "area", "base", "wbr", "source"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", zwnj: "‌", zwj: "‍", shy: "­",
  mdash: "—", ndash: "–", hellip: "…", middot: "·", bull: "•",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  sect: "§", para: "¶", copy: "©", reg: "®", deg: "°", plusmn: "±",
  times: "×", divide: "÷", prime: "′", Prime: "″", dagger: "†", Dagger: "‡",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return String.fromCodePoint(code);
    }
    const value = NAMED_ENTITIES[body];
    if (value === undefined) throw new Error(`XHTML_ENTITY: unknown named entity ${whole}`);
    return value;
  });
}

function localName(name: string): string {
  const lower = name.toLowerCase();
  const colon = lower.indexOf(":");
  return colon >= 0 ? lower.slice(colon + 1) : lower;
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** 找到从 from 起第一个不在引号内的 '>'。 */
function tagEnd(source: string, from: number): number {
  let quote = "";
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  throw new Error("XHTML_PARSE: unterminated tag");
}

/** 解析为一个合成根元素（name 为 "#document"）。 */
export function parseXhtml(source: string): XmlElement {
  const root: XmlElement = { type: "element", name: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let i = 0;
  const pushText = (value: string) => {
    if (value) stack[stack.length - 1].children.push({ type: "text", value });
  };
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt < 0) {
      pushText(decodeEntities(source.slice(i)));
      break;
    }
    pushText(decodeEntities(source.slice(i, lt)));
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      if (end < 0) throw new Error("XHTML_PARSE: unterminated comment");
      i = end + 3;
    } else if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      if (end < 0) throw new Error("XHTML_PARSE: unterminated CDATA");
      pushText(source.slice(lt + 9, end));
      i = end + 3;
    } else if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt + 2);
      if (end < 0) throw new Error("XHTML_PARSE: unterminated processing instruction");
      i = end + 2;
    } else if (source.startsWith("<!", lt)) {
      const bracket = source.indexOf("[", lt);
      const close = source.indexOf(">", lt);
      const end = bracket >= 0 && bracket < close ? source.indexOf("]>", bracket) + 1 : close;
      if (end <= 0) throw new Error("XHTML_PARSE: unterminated declaration");
      i = end + 1;
    } else if (source[lt + 1] === "/") {
      const end = tagEnd(source, lt);
      const name = localName(source.slice(lt + 2, end).trim());
      const index = stack.map((element) => element.name).lastIndexOf(name);
      if (index > 0) stack.length = index;
      i = end + 1;
    } else {
      const end = tagEnd(source, lt);
      let inner = source.slice(lt + 1, end);
      const selfClosing = inner.endsWith("/");
      if (selfClosing) inner = inner.slice(0, -1);
      const nameMatch = /^[^\s/>]+/.exec(inner);
      if (!nameMatch) throw new Error(`XHTML_PARSE: malformed tag at offset ${lt}`);
      const element: XmlElement = {
        type: "element",
        name: localName(nameMatch[0]),
        attrs: parseAttributes(inner.slice(nameMatch[0].length)),
        children: [],
      };
      stack[stack.length - 1].children.push(element);
      if (!selfClosing && !VOID.has(element.name)) stack.push(element);
      i = end + 1;
    }
  }
  return root;
}

export function textContent(node: XmlNode): string {
  if (node.type === "text") return node.value;
  return node.children.map(textContent).join("");
}

export function* walkElements(node: XmlElement): Generator<XmlElement> {
  yield node;
  for (const child of node.children) if (child.type === "element") yield* walkElements(child);
}

export function findFirst(node: XmlElement, name: string): XmlElement | null {
  for (const element of walkElements(node)) if (element.name === name) return element;
  return null;
}

export function classList(element: XmlElement): string[] {
  return (element.attrs.class ?? "").split(/\s+/).filter(Boolean);
}

export function epubTypes(element: XmlElement): string[] {
  return (element.attrs["epub:type"] ?? "").split(/\s+/).filter(Boolean);
}
