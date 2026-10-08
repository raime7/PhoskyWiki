// 书籍流水线工作目录产物的共享类型（#105「流水线」「缝 2」；ADR-0009）。
//
// 每个命令只读写工作目录中的确定文件（布局见 workdir.ts 与 README.md）。
// 这里是各票据（#107–#112）之间的契约：改字段要同步升级 schema 标识，
// 不在命令内部另起私有格式。约定：
// - 文件内不写时间戳以外的非确定内容；freeze 产物完全不含时间戳，重跑逐字节一致。
// - 文本偏移一律是 JS 字符串下标（UTF-16 码元），区间半开 [start, end)。
// - 句子序号从 1 起；摘录引用的起止句为闭区间。
// - 站点页面与修订 ID 是正整数（与 src/db/schema.ts 一致）。

import type { SubmissionKind } from "@/db/schema";

// ---------------------------------------------------------------------------
// 基础标识
// ---------------------------------------------------------------------------

/** 来源 ID：操作者在 freeze 时指定，`[a-z0-9][a-z0-9-]*`，在工作目录内唯一。 */
export type SourceId = string;

/**
 * 段落 ID：`<sourceId>:<unit>.p<ordinal>`，如 `xiaoluoji:d07.p12`。
 * unit 是来源中的结构单元（EPUB 为书脊序号 `d07`，非书脊文档为 `m03`，TXT/MD 为 `t`），
 * ordinal 是该单元内全部段落的序号（与章节范围无关），所以改范围或重跑都不改变既有 ID。
 */
export type ParagraphId = string;

/** 句子 ID：`<段落 ID>.s<n>`，n 从 1 起。 */
export type SentenceId = string;

/** 概念键：会话为候选指定，`[a-z0-9][a-z0-9-]*`，用作 perspectives/<key>/ 目录名。 */
export type ConceptKey = string;

/** 论点 ID：在同一视角内唯一，如 `k1`；增量更新时既有论点保留原 ID。 */
export type ClaimId = string;

/** 站点页面 ID 与修订 ID（serial 正整数）。 */
export type PageId = number;
export type RevisionId = number;

// ---------------------------------------------------------------------------
// 1. 冻结（freeze，#107）：sources/<sourceId>/
// ---------------------------------------------------------------------------

export type SourceFormat = "epub" | "txt" | "md";

/** 层次。正文/说明/附释由段首标记切换并延续到下一个章节标记；注释类由注释识别规则判定。 */
export type Layer = "正文" | "说明" | "附释" | "译注" | "原注" | "编者注" | "注";

export const LAYERS: readonly Layer[] = ["正文", "说明", "附释", "译注", "原注", "编者注", "注"];

export type EmphasisKind = "strong" | "em";

/** 段落文本中的一段强调（偏移基于规范化后的 text）。 */
export interface EmphasisSpan {
  start: number;
  end: number;
  kind: EmphasisKind;
  /** 产生该强调的原始标记，如 `span.point`、`em`、`**`，供核对。 */
  via: string;
}

export interface FrozenSentence {
  id: SentenceId;
  n: number;
  start: number;
  end: number;
}

/** 正文中的注号：可见注号文字保留在 text 中，这里记录其位置与所指注释段落。 */
export interface NoteRef {
  marker: string;
  start: number;
  end: number;
  note: ParagraphId;
}

/** 段落在原文件中的位置，供人工回查。 */
export interface SourceLocator {
  /** EPUB 成员路径；TXT/MD 为原文件名 */
  file: string;
  /** EPUB 中最近的元素 id；TXT/MD 为 null */
  anchor: string | null;
  /** TXT/MD 的起止行号（1 起）；EPUB 为 null */
  lines: [number, number] | null;
}

/** paragraphs.jsonl 的一行。 */
export interface FrozenParagraph {
  id: ParagraphId;
  sourceId: SourceId;
  unit: string;
  ordinal: number;
  /** 在整本书中的阅读顺序（只用于排序） */
  order: number;
  /** false = 范围外、仅因被范围内注号引用而收录的注释段落 */
  inRange: boolean;
  /** 外层标题链，如 ["第一篇 存在论", "A．质"] */
  chapterPath: string[];
  /** 当前节号标签，如 "§86"；无节号为 null */
  section: string | null;
  layer: Layer;
  /** 带编号的层次显示名，如 "附释一"；无编号时等于 layer */
  layerLabel: string;
  /** 规范化后的可见文字（引文回填与逐字回查的唯一依据） */
  text: string;
  /** 规范化前的原始文字（含原排版空白） */
  rawText: string;
  textSha256: string;
  emphasis: EmphasisSpan[];
  sentences: FrozenSentence[];
  noteRefs: NoteRef[];
  /** 本段是注释时，引用它的段落 */
  noteFor: ParagraphId[];
  locator: SourceLocator;
}

/** 章节标记：标题或节号。freeze 的 --from/--to 按 id 或标题匹配。 */
export interface Landmark {
  id: string; // `<sourceId>:<unit>.h<n>`
  kind: "heading" | "section";
  /** 标题层级 1–6；节号固定为 7 */
  level: number;
  title: string;
  order: number;
  inRange: boolean;
}

export interface NormalizationLogEntry {
  paragraph: ParagraphId;
  rules: NormalizationRule[];
  before: string;
  after: string;
}

export type NormalizationRule =
  | "trim-paragraph-boundary"
  | "collapse-whitespace"
  | "join-wrapped-cjk-lines"
  | "remove-invisible-characters"
  | "txt-emphasis-markup";

/** 冻结规则（可用 --rules JSON 覆盖默认值；生效值写入来源清单）。正则均为 JS 源码字符串。 */
export interface FreezeRules {
  /** 整段匹配即为节号标记（不成段），捕获组可用于 label，如 { "^§\\s*(\\d+)$" → "§$1" } */
  sectionMarkers: { pattern: string; label: string }[];
  /** 段首匹配即切换层次；sticky=true 时延续到下一个章节标记，否则只作用于本段 */
  layerMarkers: { pattern: string; layer: Layer; label: string; sticky: boolean }[];
  /** 注释段落按文字判定层次，首个命中者生效；都不命中为 "注" */
  noteLayers: { pattern: string; layer: Layer }[];
  /** 仅 TXT：整行匹配视为标题（另有 `#` 行）；maxLength 防止正文误判 */
  txtHeadings: { pattern: string; level: number; maxLength: number }[];
  /** 仅 EPUB：class → 强调种类（em/i/strong/b 标签总是识别） */
  emphasisClasses: Record<string, EmphasisKind>;
  /** 仅 EPUB：class 命中即视为注释容器 */
  noteContainerClasses: string[];
}

export interface SourceMember {
  path: string;
  sha256: string;
}

/** sources/<id>/manifest.json：来源清单。 */
export interface SourceManifest {
  schema: typeof SCHEMAS.sourceManifest;
  sourceId: SourceId;
  work: {
    title: string;
    /** 著者，即该来源生成视角的诠释者（ADR-0007/0009） */
    author: string;
    translator: string | null;
    /** 译本补充说明，如出版社与年份 */
    edition: string | null;
  };
  file: {
    /** 操作者给出的原文件名（不含目录） */
    name: string;
    format: SourceFormat;
    sha256: string;
    bytes: number;
  };
  /** EPUB 中实际产出段落的成员文件及其哈希；TXT/MD 为空 */
  members: SourceMember[];
  range: {
    from: string | null;
    to: string | null;
    /** 解析到的起止章节标记 ID；整本书为 null */
    fromLandmark: string | null;
    toLandmark: string | null;
  };
  rules: FreezeRules;
  counts: { paragraphs: number; inRange: number; notes: number; sentences: number; normalized: number };
  /** 其余冻结产物的哈希，供后续命令发现篡改 */
  outputs: { paragraphs: string; landmarks: string; normalizationLog: string };
}

/** workdir.json：一个工作目录只服务一位诠释者，可含多本来源（增量并入）。 */
export interface WorkdirManifest {
  schema: typeof SCHEMAS.workdir;
  interpreter: string;
  sources: { id: SourceId; title: string; fileSha256: string }[];
}

// ---------------------------------------------------------------------------
// 2. 候选（candidates，#108）：candidates/
// ---------------------------------------------------------------------------

/** 会话产出的一个拟定论点：只是候选阶段的依据，不是解读文字。 */
export interface ProposedClaim {
  summary: string;
  paragraphs: ParagraphId[];
}

/** candidates/session-candidates.json：会话产出的候选与去重结果。 */
export interface SessionCandidates {
  schema: typeof SCHEMAS.sessionCandidates;
  interpreter: string;
  sourceIds: SourceId[];
  candidates: SessionCandidate[];
}

export interface SessionCandidate {
  key: ConceptKey;
  canonicalName: string;
  /** 别名与译名变体（同一概念） */
  aliases: string[];
  /** 原文术语，如 "Dasein" */
  originalTerms: string[];
  /** 已并入本候选的同义候选名（合并记录） */
  mergedFrom: string[];
  /** 相关但不相同的概念（只做双链，不合并） */
  related: string[];
  /** dedicated = 诠释者专门论述；mention = 顺带提及 */
  treatment: "dedicated" | "mention";
  proposedClaims: ProposedClaim[];
  /** 以该概念为中心的段落 */
  centralParagraphs: ParagraphId[];
  notes: string | null;
}

/** candidates/site-terms.json：站上已有词条、诠释者与视角的导出（只读查询或手工导出）。 */
export interface SiteExport {
  schema: typeof SCHEMAS.siteExport;
  exportedAt: string;
  origin: string;
  terms: { pageId: PageId; title: string; slug: string; aliases: string[]; deleted: boolean }[];
  interpreters: { pageId: PageId; title: string; slug: string; deleted: boolean }[];
  perspectives: {
    pageId: PageId;
    termId: PageId;
    interpreterId: PageId;
    headRevisionId: RevisionId;
    deleted: boolean;
  }[];
}

export type AdmissionBasis = "claims>=2" | "central-paragraph";

export interface CandidateEntry {
  key: ConceptKey;
  canonicalName: string;
  aliases: string[];
  originalTerms: string[];
  related: string[];
  existingTerm: { pageId: PageId; title: string; matchedBy: "title" | "alias" } | null;
  existingPerspective: { pageId: PageId; headRevisionId: RevisionId } | null;
  proposedClaimCount: number;
  evidenceParagraphs: ParagraphId[];
  admission: AdmissionBasis[];
}

export interface ExcludedCandidate {
  key: ConceptKey;
  canonicalName: string;
  reason: string;
}

/** candidates/candidates.json：供站长确认的候选清单（命令生成）。 */
export interface CandidateList {
  schema: typeof SCHEMAS.candidateList;
  interpreter: string;
  /** 所依据的会话产物与站点导出的哈希 */
  inputs: { sessionCandidates: string; siteExport: string };
  entries: CandidateEntry[];
  excluded: ExcludedCandidate[];
}

/** candidates/confirmation.json：站长确认。绑定清单哈希，清单重生成即失效。 */
export interface CandidateConfirmation {
  schema: typeof SCHEMAS.confirmation;
  candidateListSha256: string;
  confirmedBy: string;
  confirmedAt: string;
  confirmed: ConceptKey[];
}

// ---------------------------------------------------------------------------
// 3. 论点映射与解读草稿（会话环节）：perspectives/<key>/claim-map.json
// ---------------------------------------------------------------------------

/** 摘录引用：模型只输出位置，引文文字一律由程序从冻结来源回填。 */
export interface ExcerptRef {
  paragraph: ParagraphId;
  /** 起止句序号，闭区间；覆盖整段时为 1..句数 */
  from: number;
  to: number;
}

export interface Claim {
  id: ClaimId;
  /** 论点小节标题 */
  heading: string;
  /** 解读 Markdown，双链写作 [[规范名|原词]]。增量论点映射中：new = 全部解读；extended = 追加在原解读之后的部分（可为空）；kept = 空 */
  exposition: string;
  /** 1–3 段摘录（超出由 validate 报告）。增量论点映射中只列新增的摘录（kept 为空），既有摘录由 head 原样保留 */
  excerpts: ExcerptRef[];
  /** 增量更新：既有论点原样保留 / 追加了材料 / 新增论点；新建视角为 "new"。增量时 kept/extended 按 head 顺序、以标题对应既有论点 */
  revision: "kept" | "extended" | "new";
}

export interface ClaimMap {
  schema: typeof SCHEMAS.claimMap;
  conceptKey: ConceptKey;
  /** 词条规范名 */
  term: string;
  interpreter: string;
  /** 一句话核心 */
  core: string;
  claims: Claim[];
}

// ---------------------------------------------------------------------------
// 4. 组装（assemble，#109）：perspectives/<key>/perspective.md + assembled.json
// ---------------------------------------------------------------------------

export interface AssembledExcerpt {
  claimId: ClaimId;
  ref: ExcerptRef;
  /** 回填的引文可见文字（不含截断标记） */
  text: string;
  truncatedStart: boolean;
  truncatedEnd: boolean;
  /** 出处行，如 "《小逻辑》，§86，附释，贺麟译" */
  citation: string;
}

/** 资料覆盖范围：由实际引用推导。 */
export interface SourceCoverage {
  sourceId: SourceId;
  title: string;
  translator: string | null;
  edition: string | null;
  /** 冻结时的章节范围描述 */
  range: { from: string | null; to: string | null };
  paragraphs: ParagraphId[];
}

export interface AssembledPerspective {
  schema: typeof SCHEMAS.assembled;
  conceptKey: ConceptKey;
  term: string;
  interpreter: string;
  /** new = 新建视角；edit = 以 baseRevisionId 为基础编辑现有视角 */
  mode: "new" | "edit";
  baseRevisionId: RevisionId | null;
  inputs: { claimMap: string; candidateList: string; confirmation: string };
  markdownSha256: string;
  excerpts: AssembledExcerpt[];
  coverage: SourceCoverage[];
}

// ---------------------------------------------------------------------------
// 5. 审稿（会话子代理）：perspectives/<key>/review.json
// ---------------------------------------------------------------------------

export type ReviewIssueKind =
  | "excerpt-does-not-support-claim"
  | "overreach"
  | "foreign-view"
  | "evaluation"
  | "misreading"
  | "other";

export interface ReviewIssue {
  claimId: ClaimId | null;
  kind: ReviewIssueKind;
  severity: "blocker" | "warning" | "note";
  message: string;
  excerpt: ExcerptRef | null;
}

export interface ReviewReport {
  schema: typeof SCHEMAS.review;
  conceptKey: ConceptKey;
  /** 审阅时 perspective.md 的哈希；与当前稿不一致即过期 */
  perspectiveSha256: string;
  reviewer: string;
  summary: string;
  issues: ReviewIssue[];
}

// ---------------------------------------------------------------------------
// 6. 校验（validate，#110）：perspectives/<key>/validation.json
// ---------------------------------------------------------------------------

export type ValidationRule =
  | "limit.claims"
  | "limit.excerpts-per-claim"
  | "limit.excerpt-length"
  | "limit.exposition-length"
  | "template"
  | "wikilink.unknown-target"
  | "wikilink.reserved-at"
  | "coverage"
  | "quotation"
  | "pseudo-interpreter"
  | "locked-block"
  | "unconfirmed";

export interface ValidationFinding {
  rule: ValidationRule;
  /** limit 类可由人工放行；error 不可放行 */
  severity: "error" | "limit";
  message: string;
  claimId: ClaimId | null;
}

/** perspectives/<key>/overrides.json：人工放行的超限项。 */
export interface LimitOverride {
  rule: ValidationRule;
  claimId: ClaimId | null;
  reason: string;
  approvedBy: string;
}

export interface ValidationReport {
  schema: typeof SCHEMAS.validation;
  conceptKey: ConceptKey;
  perspectiveSha256: string;
  ok: boolean;
  findings: ValidationFinding[];
  overridden: LimitOverride[];
}

// ---------------------------------------------------------------------------
// 7. 增量更新（#111）：perspectives/<key>/base.json + locks.json
// ---------------------------------------------------------------------------

/** 现有视角的导出：当前 head 与上一次 AI 编者账号产生的修订（incremental 由 --head/--last-ai 写入）。 */
export interface IncrementalBase {
  schema: typeof SCHEMAS.incrementalBase;
  pageId: PageId;
  head: { revisionId: RevisionId; content: string };
  lastAi: { revisionId: RevisionId; content: string } | null;
}

/** 人工改动过、因而锁定的块：head 正文（分隔线之前）中不以同样文字出现在上一次 AI 修订里的顶层块（blocks.ts 的切法）。 */
export interface LockedBlock {
  /** head 中的块序号（0 起） */
  index: number;
  sha256: string;
  text: string;
  reason: "human-edit";
}

export interface LockInfo {
  schema: typeof SCHEMAS.locks;
  pageId: PageId;
  headRevisionId: RevisionId;
  lastAiRevisionId: RevisionId | null;
  blocks: LockedBlock[];
}

// ---------------------------------------------------------------------------
// 8. 提交（submit，#112）：submit/plan.json + submit/ledger.jsonl
// ---------------------------------------------------------------------------

/** 发往 POST /api/submissions 的请求体（字段与站点路由一致；note 见 #106）。 */
export type SubmissionRequest =
  | { kind: Extract<SubmissionKind, "new_term">; title: string; aliases: string[]; summary: string; note: string | null }
  | { kind: Extract<SubmissionKind, "new_interpreter">; title: string; summary: string; note: string | null }
  | { kind: Extract<SubmissionKind, "new_perspective">; termId: PageId; interpreterId: PageId; content: string; note: string | null }
  | { kind: Extract<SubmissionKind, "edit">; pageId: PageId; baseRevisionId: RevisionId; content: string; note: string | null };

export interface PlannedSubmission {
  /** 幂等键，如 `new_term:主体性`、`perspective:c001`；账本按它去重 */
  opKey: string;
  /** entities = 新诠释者与新词条；perspectives = 新视角与编辑（须待第一阶段受理） */
  phase: "entities" | "perspectives";
  conceptKey: ConceptKey | null;
  /** 第一阶段尚未受理时，ID 以 opKey 引用占位，正式提交前替换 */
  dependsOn: string[];
  request: SubmissionRequest;
  contentSha256: string | null;
}

export interface SubmitPlan {
  schema: typeof SCHEMAS.submitPlan;
  origin: string;
  requests: PlannedSubmission[];
}

export interface LedgerEntry {
  at: string;
  opKey: string;
  event: "intent" | "submitted" | "failed" | "reconciled";
  contentSha256: string | null;
  httpStatus: number | null;
  /** 站点返回：pending 提交 ID，或直编生效的页面 ID */
  submissionId: number | null;
  pageId: PageId | null;
  message: string | null;
}

// ---------------------------------------------------------------------------
// 产物 schema 标识与伪诠释者约束
// ---------------------------------------------------------------------------

export const SCHEMAS = {
  workdir: "phosky.book-pipeline/workdir@1",
  sourceManifest: "phosky.book-pipeline/source-manifest@1",
  sessionCandidates: "phosky.book-pipeline/session-candidates@1",
  siteExport: "phosky.book-pipeline/site-export@1",
  candidateList: "phosky.book-pipeline/candidate-list@1",
  confirmation: "phosky.book-pipeline/confirmation@1",
  claimMap: "phosky.book-pipeline/claim-map@1",
  assembled: "phosky.book-pipeline/assembled@1",
  review: "phosky.book-pipeline/review@1",
  validation: "phosky.book-pipeline/validation@1",
  incrementalBase: "phosky.book-pipeline/incremental-base@1",
  locks: "phosky.book-pipeline/locks@1",
  submitPlan: "phosky.book-pipeline/submit-plan@1",
} as const;

/** 编者整理的说明不构成诠释者（ADR-0007）；著者与诠释者名命中即拒绝。 */
export const PSEUDO_INTERPRETER_PATTERN = /编委会|编辑部|编者|编写组|本站|站方|^AI$|人工智能/;

export function isPseudoInterpreter(name: string): boolean {
  return PSEUDO_INTERPRETER_PATTERN.test(name.trim());
}
