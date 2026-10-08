// 生成自造样例书 sample-book.epub（内容为虚构，无版权材料）。输出确定：固定时间戳与条目顺序。
// 运行：node scripts/book-pipeline/fixtures/make-sample-epub.mjs
// 夹具覆盖：书脊中的 nav（应跳过）、h1/h2 标题、§ 节号段、span.point / em / b 强调、
// 〔说明〕与附释一/附释二层次及其续段、跨文档注号（双向链接与 epub:type=noteref + aside 脚注）、
// 命名与数字实体、<br/> 与排版换行、一个多句长段落。

import { writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const LONG =
  "这一段故意写得很长，用来检验长段落的切句与引用。人们往往以为，开端只是一个可以随意选择的起点，" +
  "仿佛无论从哪里出发，思维都能够同样顺利地展开自身；然而这种看法恰恰忽略了开端本身所包含的困难。" +
  "正如人们常说的那样，“开端是最困难的。”";
const LONG_REST =
  "倘若开端已经包含了某种规定，那么它就不再是纯粹的开端，而是某种已经被中介了的东西；" +
  "倘若它什么规定也不包含，那么它似乎又什么也不是。难道我们因此就应当放弃寻找开端吗？绝不！" +
  "我们毋宁应当把这种困难本身当作考察的对象，看清它是如何从开端的概念中必然地产生出来的。" +
  "只有这样，后面关于质、关于界限、关于变化的全部论述，才不会显得是从外面随意加上去的。";

const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>
${body}
</body>
</html>
`;

export const FILES = [
  ["mimetype", "application/epub+zip"],
  [
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`,
  ],
  [
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:00000000-0000-4000-8000-000000000105</dc:identifier>
    <dc:title>论尺度（样例）</dc:title>
    <dc:creator>范例思</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="nav"/>
    <itemref idref="ch1"/>
    <itemref idref="notes" linear="no"/>
  </spine>
</package>
`,
  ],
  [
    "OEBPS/nav.xhtml",
    xhtml(
      "目录",
      `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>
  <li><a href="text/ch1.xhtml#h-part1">第一篇　存在</a></li>
</ol></nav>`,
    ),
  ],
  ["OEBPS/style.css", ".point { text-emphasis: dot; }\n"],
  [
    "OEBPS/text/ch1.xhtml",
    xhtml(
      "第一篇",
      `<section id="part1">
<h1 id="h-part1">第一篇　存在</h1>
<h2 id="h-quality">A．质</h2>
<p class="sec">§ 1</p>
<p id="p-1-1">存在是<span class="point">直接的</span>规定性。它不是别的东西，
    而只是<em>它自己</em>。</p>
<p>〔说明〕这里所说的存在，不应当被理解为某种经验的事物&mdash;&#x2014;它毋宁是思维的<b>开端</b>。</p>
<p>说明的第二段<br/>仍然属于说明层次。</p>
<p class="sec">§&nbsp;2</p>
<p><b>附释一：</b>${LONG}<a id="r1" href="notes.xhtml#n1">[1]</a>${LONG_REST}</p>
<p>附释的续段没有任何标记，却仍属附释一。这里有一条作者原注<a epub:type="noteref" href="notes.xhtml#n2">*</a>。</p>
<p>附释二：第二个附释从这里开始。</p>
<h2 id="h-quantity">B．量</h2>
<p class="sec">§ 3</p>
<p>量是被扬弃了的质。</p>
</section>`,
    ),
  ],
  [
    "OEBPS/text/notes.xhtml",
    xhtml(
      "注释",
      `<h2>注释</h2>
<p><a id="n1" href="ch1.xhtml#r1">[1]</a>此语出自一句古老格言。——译者注</p>
<aside epub:type="footnote" id="n2"><p>作者原注：本书初版无此句。</p></aside>`,
    ),
  ],
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data) => {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

export function buildZip(files) {
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, "utf8");
    const stored = name === "mimetype";
    const body = stored ? data : deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL("./sample-book.epub", import.meta.url));
  writeFileSync(out, buildZip(FILES));
  console.log(out);
}
