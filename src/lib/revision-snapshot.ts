/** Structured metadata is separate from Markdown; legacy content cannot recover it. */
export interface TermSnapshot {
  version: 1;
  type: "term";
  title: string;
  summary: string;
  aliases: string[];
}

export type RevisionSource = "legacy" | "baseline" | "create" | "approval" | "direct" | "rollback";

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
