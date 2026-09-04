"use client";

import Link from "next/link";
import { useState } from "react";

export interface PerspectiveListProps {
  items: {
    pageId: number;
    title: string;
    href: string;
    interpreterName: string;
    interpreterHref: string;
    /** 编者置顶（管理员标记）：显示置顶徽标 */
    pinned?: boolean;
    linkCount: number;
  }[];
}

// 词条页视角列表默认露出条数（spec：默认露 5~8 条 + 展开全部）
const DEFAULT_VISIBLE = 5;

export function PerspectiveList({ items }: PerspectiveListProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = Math.max(0, items.length - DEFAULT_VISIBLE);

  return (
    <div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {visible.map((item) => (
          <li key={item.pageId} className="flex items-baseline justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <Link href={item.href} className="font-medium hover:underline">
                {item.title}
              </Link>
              {item.pinned && (
                <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs">
                  置顶
                </span>
              )}
              <span className="ml-2 text-sm text-muted-foreground">
                <Link
                  href={item.interpreterHref}
                  className="hover:text-foreground hover:underline"
                >
                  {item.interpreterName}
                </Link>
              </span>
            </div>
            <span
              className="shrink-0 text-xs text-muted-foreground"
              title="被站内双链引用的次数"
            >
              {item.linkCount} 次引用
            </span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {expanded ? "收起" : `展开全部（还有 ${hiddenCount} 条）`}
        </button>
      )}
    </div>
  );
}
