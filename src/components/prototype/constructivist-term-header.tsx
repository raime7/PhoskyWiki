// PROTOTYPE（一次性代码）：词条枢纽页页头的三档构成强度。
import Link from "next/link";
import type { ReactNode } from "react";

import type { ProtoVariant } from "./variants";

export function ConstructivistTermHeader({ variant, title, summary, perspectiveCount, actions }: {
  variant: Exclude<ProtoVariant, "current">;
  title: string;
  summary: string;
  perspectiveCount: number;
  actions: ReactNode;
}) {
  return (
    <header className={`pw-term-head pw-term-head--${variant}`}>
      <nav aria-label="面包屑" className="pw-crumbs">
        <Link href="/">首页</Link>
        <span aria-hidden="true">/</span>
        <Link href="/terms">词条索引</Link>
      </nav>
      {variant === "poster" && <span className="pw-term-wedge" aria-hidden="true" />}
      <div className="pw-term-title-row">
        <h1 className="pw-display pw-term-title">{title}</h1>
        <p className="pw-term-count">{perspectiveCount} 位诠释者</p>
      </div>
      {summary && <p className="pw-term-summary">{summary}</p>}
      <div className="pw-term-actions">{actions}</div>
      <nav aria-label="词条页内导航" className="pw-term-nav">
        <a href="#perspectives-heading">诠释者视角</a>
        <a href="#term-resources-heading">词条资料</a>
        <a href="#term-explore-heading">继续探索</a>
        <a href="#term-agent">Agent 解读</a>
        <a href="#comments">词条总评论</a>
      </nav>
    </header>
  );
}
