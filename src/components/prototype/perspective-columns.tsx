// PROTOTYPE（一次性代码）：词条枢纽页的视角并置列。
// 并置即 ADR-0007"平等并列"的视觉表达：列顺序沿用既有排序（兴趣 → 站内引用 → 创建序），
// 各列同宽同形，不做首列放大。桌面端横向排开（多了横向滚动），窄屏退回列表。
import Link from "next/link";

import type { ProtoVariant } from "./variants";

export interface ColumnItem {
  pageId: number;
  title: string;
  href: string;
  interpreterName: string;
  interpreterHref: string;
  linkCount: number;
}

export function PerspectiveColumns({ items, excerpts, variant }: {
  items: ColumnItem[];
  excerpts: Record<number, string>;
  variant: Exclude<ProtoVariant, "current">;
}) {
  return (
    <div className={`pw-columns pw-columns--${variant}`}>
      <ul aria-label="视角并置" className="pw-columns-track">
        {items.map(item => (
          <li key={item.pageId} className="pw-column">
            <div className="pw-column-head">
              <Link href={item.interpreterHref} className="pw-column-interpreter">{item.interpreterName}</Link>
            </div>
            <Link href={item.href} className="pw-column-title">{item.title}</Link>
            {excerpts[item.pageId] && <p className="pw-column-excerpt">{excerpts[item.pageId]}</p>}
            <div className="pw-column-foot">
              <Link href={item.href} aria-label={`读全文：${item.title}`}>读全文</Link>
              <span title="被站内双链引用的次数">{item.linkCount} 次引用</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
