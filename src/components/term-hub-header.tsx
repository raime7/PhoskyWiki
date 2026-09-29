import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./term-hub.module.css";

/** 词条枢纽页页头（ADR-0008）：巨字标题，朱红楔形从右上角切入，页内导航压在墨带上。 */
export function TermHubHeader({ title, summary, perspectiveCount, actions }: {
  title: string;
  summary: string;
  perspectiveCount: number;
  actions: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <nav aria-label="面包屑" className={styles.crumbs}>
        <Link href="/">首页</Link>
        <span aria-hidden="true">/</span>
        <Link href="/terms">词条索引</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{title}</span>
      </nav>
      <span className={styles.wedge} aria-hidden="true" />
      <div className={styles.titleRow}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.count}>{perspectiveCount} 位诠释者</p>
      </div>
      {summary && <p className={styles.summary}>{summary}</p>}
      <div className={styles.actions}>{actions}</div>
      <nav aria-label="词条页内导航" className={styles.pageNav}>
        <a href="#perspectives-heading">诠释者视角</a>
        <a href="#term-resources-heading">词条资料</a>
        <a href="#term-explore-heading">继续探索</a>
        <a href="#term-agent">Agent 解读</a>
        <a href="#comments">词条总评论</a>
      </nav>
    </header>
  );
}
