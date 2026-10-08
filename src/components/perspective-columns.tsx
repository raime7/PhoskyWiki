import Link from "next/link";

import { reorderPerspectivesByInterest } from "@/lib/interest-tags";
import styles from "./term-hub.module.css";

export interface PerspectiveColumnsProps {
  items: {
    pageId: number;
    title: string;
    href: string;
    interpreterId: number;
    interpreterName: string;
    interpreterHref: string;
    linkCount: number;
  }[];
  /** 各视角当前修订的首段摘录，按页 id 索引；缺失时该列只显示标题。 */
  excerpts: Record<number, string>;
  /**
   * 服务端（登录态）兴趣重排用的诠释者 id 集：items 已按它排好，这里幂等地
   * 再排一次即可；游客和账号均由发现模块提供经过有效对象过滤与学派展开的集合。
   */
  interestInterpreterIds?: number[] | null;
}

/**
 * 词条枢纽页的视角并置列（ADR-0008）。并置即 ADR-0007"平等并列"的视觉表达：
 * 各列同宽同形、不放大首列，列序沿用既有排序（兴趣 → 站内引用 → 创建序）。
 * 宽屏横向排开，放不下时横向滚动并露出下一列一角；窄屏退回纵向列表。
 */
export function PerspectiveColumns({ items, excerpts, interestInterpreterIds = null }: PerspectiveColumnsProps) {
  const reordered = interestInterpreterIds !== null && interestInterpreterIds.length > 0;
  const ordered = reordered ? reorderPerspectivesByInterest(items, new Set(interestInterpreterIds)) : items;
  return (
    <div>
      {reordered && (
        <p data-testid="interest-reorder-hint" className="mb-3 text-sm text-muted-foreground">
          已按你的兴趣把相关诠释者的视角排前。
        </p>
      )}
      <div className={styles.columns}>
        <ul aria-label="视角目录" className={styles.track}>
          {ordered.map(item => (
            <li key={item.pageId} className={styles.column}>
              <Link href={item.interpreterHref} className={styles.interpreter}>{item.interpreterName}</Link>
              <Link href={item.href} id={`perspective-column-${item.pageId}`} className={styles.columnTitle}>{item.title}</Link>
              {excerpts[item.pageId] && <p className={styles.excerpt}>{excerpts[item.pageId]}</p>}
              <div className={styles.columnFoot}>
                {/* 描述而非名称里带标题：各列"读全文"可区分，又不和标题链接抢同一个名字 */}
                <Link href={item.href} aria-describedby={`perspective-column-${item.pageId}`}>读全文</Link>
                <span title="被站内双链引用的次数">{item.linkCount} 次引用</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
