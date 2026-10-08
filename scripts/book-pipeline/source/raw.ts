// 各格式读取器的共同输出：按阅读顺序排列的原始块，尚未规范化、未编号。

import type { EmphasisKind, FreezeRules, NormalizationRule, SourceFormat, SourceLocator, SourceMember } from "../types";

export interface RawEmphasis {
  start: number;
  end: number;
  kind: EmphasisKind;
  via: string;
}

export interface RawLink {
  start: number;
  end: number;
  /** 解析后的目标键 `<成员路径>#<id>` */
  target: string;
  /** EPUB 明示的 epub:type="noteref" */
  noteref: boolean;
}

export interface RawBlock {
  kind: "heading" | "paragraph";
  /** 标题层级 1–6；段落为 0 */
  level: number;
  /** 来源中的原样文字（TXT/MD 含标记；EPUB 与 raw 相同） */
  original: string;
  /** 可见文字，未做空白规范化；偏移以此为准 */
  raw: string;
  emphasis: RawEmphasis[];
  links: RawLink[];
  /** 锚定在本块上的目标键（自身、内部或紧邻容器的 id） */
  ids: string[];
  /** 位于注释容器内 */
  noteContainer: boolean;
  locator: SourceLocator;
  /** 读取器阶段已做的变换（写入规范化日志） */
  readerRules: NormalizationRule[];
}

export interface RawUnit {
  /** 段落 ID 中的单元键：EPUB `d01`/`m01`，TXT/MD `t` */
  key: string;
  /** false = 非书脊或 linear="no" 的辅助文档：不进入范围，只在被注号引用时收录 */
  inSpine: boolean;
  /** EPUB 成员文件及哈希；TXT/MD 为 null */
  member: SourceMember | null;
  blocks: RawBlock[];
}

export interface RawBook {
  format: SourceFormat;
  units: RawUnit[];
}

export type Reader = (bytes: Buffer, fileName: string, rules: FreezeRules) => RawBook;
