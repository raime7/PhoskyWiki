/** Structured metadata is separate from Markdown; legacy content cannot recover it. */
export interface TermSnapshot {
  version: 1;
  type: "term";
  title: string;
  summary: string;
  aliases: string[];
}

export type RevisionSource = "legacy" | "baseline" | "create" | "approval" | "direct" | "rollback";

export const revisionSourceLabels: Record<RevisionSource, string> = {
  legacy: "旧历史（来源未记录）", baseline: "起始快照（当时的词条信息）", create: "新建",
  approval: "普通受理", direct: "管理员直编", rollback: "回滚",
};

export const legacyTermHistoryNote = "此旧修订未保存词条信息快照，无法恢复标题、简介和别名；历史正文仍可查看。";

export function termSnapshot(value: { title: string; summary: string; aliases: string[] }): TermSnapshot {
  return { version: 1, type: "term", title: value.title, summary: value.summary, aliases: [...value.aliases] };
}

export function compareTermMetadata(from: TermSnapshot, to: TermSnapshot) {
  return [
    { field: "title", label: "标题", before: from.title, after: to.title },
    { field: "summary", label: "简介", before: from.summary, after: to.summary },
    { field: "aliases", label: "别名", before: from.aliases.map((alias) => JSON.stringify(alias)).join("、"), after: to.aliases.map((alias) => JSON.stringify(alias)).join("、") },
  ].map((row) => ({ ...row, changed: row.before !== row.after }));
}
