import type { ReactNode } from "react";

/** 渲染 Markdown 产出的安全 HTML（renderMarkdown 已过 rehype-sanitize）。 */
export function WikiContent({ html }: { html: string }) {
  return (
    <div
      className="wiki-content prose prose-zinc dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** 页面侧栏信息框（infobox）。 */
export function Infobox({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; content: ReactNode }[];
}) {
  return (
    <aside className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="mb-3 border-b border-border pb-2 text-center font-medium">
        {title}
      </div>
      <dl className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[5.5rem_1fr] gap-2">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words">{row.content}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
