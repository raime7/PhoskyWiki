// 当前版 vs 提案的行级 diff 展示（审核队列用）。diff 现算，不落库（ADR-0004 #1）。

import { cn } from "@/lib/utils";
import { diffLines } from "@/lib/diff";

export function ContentDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = diffLines(oldText, newText);
  return (
    <pre
      data-testid="content-diff"
      className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-5"
    >
      {rows.map((row, index) => (
        <div
          key={index}
          data-diff={row.type}
          className={cn(
            "whitespace-pre-wrap px-1",
            row.type === "add" && "bg-green-500/10 text-green-700 dark:text-green-400",
            row.type === "del" && "bg-red-500/10 text-red-700 dark:text-red-400",
          )}
        >
          <span className="select-none pr-1 opacity-60">
            {row.type === "add" ? "+" : row.type === "del" ? "−" : " "}
          </span>
          {row.text}
        </div>
      ))}
    </pre>
  );
}
