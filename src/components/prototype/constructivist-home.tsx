// PROTOTYPE（构成主义视觉原型，一次性代码）：首页三档构成强度。
// 共同决定：纸 / 墨 / 朱红三色；首屏以排印为主，外加"今日词条"——按日期轮换一个
// 有两个以上视角的词条，把"一个概念、多种视角"画成构成；没有候选时只剩排印首屏。
import Link from "next/link";

import { SearchBox } from "@/components/search-box";
import type { DailyTerm } from "@/lib/prototype-constructivist-data";
import { pagePath } from "@/lib/slug";

export interface HomeData {
  terms: { id: number; title: string; slug: string; summary: string; perspectiveCount: number }[];
  recent: { id: number; slug: string; title: string; interpreterName: string; termTitle: string }[];
  schools: { id: number; slug: string; title: string; summary: string; memberCount: number; coreTermCount: number }[];
  daily: DailyTerm | null;
}

const MAX_RAYS = 6;

/* ───────────── 书卷：一本 1920 年代学术出版物的扉页，几何只用直角与粗线 ───────────── */

export function BookHome({ terms, recent, schools, daily }: HomeData) {
  return (
    <main className="pw-home pw-book mx-auto w-full max-w-[1280px] flex-1 px-4 pb-20 sm:px-6">
      <section className="pw-book-hero" aria-label="探索知识">
        <div className="min-w-0">
          <h1 className="pw-display pw-book-title">思想，<br />在分歧中展开。</h1>
          <p className="pw-book-lede">一个概念，多种视角。从一个概念或一位思想家的名字开始。</p>
          <div className="relative z-10 mt-6 max-w-xl"><SearchBox size="lg" /></div>
          <nav aria-label="三轴入口" className="pw-book-entrances">
            <Link href="/terms">词条索引</Link>
            <Link href="/interpreters">诠释者索引</Link>
            <Link href="/schools">学派</Link>
          </nav>
        </div>
        {daily && (
          <aside className="pw-book-daily" aria-labelledby="daily-heading">
            <h2 id="daily-heading" className="pw-book-daily-label">今日词条</h2>
            <Link href={daily.href} className="pw-book-daily-term">{daily.title}</Link>
            {/* 竖向粗线把一个词条接到多个视角：一对多关系本身就是构成 */}
            <ul className="pw-book-daily-list">
              {daily.perspectives.slice(0, MAX_RAYS).map(p => (
                <li key={p.id}>
                  <Link href={p.href}><strong>{p.interpreterName}</strong><span>{p.title}</span></Link>
                </li>
              ))}
            </ul>
            {daily.perspectives.length > MAX_RAYS && <Link href={daily.href} className="pw-more">另有 {daily.perspectives.length - MAX_RAYS} 个视角</Link>}
          </aside>
        )}
      </section>

      <BookSection id="terms-heading" title="探索概念" action={<Link href="/terms">浏览全部 {terms.length} 个词条</Link>}>
        <ul className="pw-book-terms">
          {terms.slice(0, 6).map(term => (
            <li key={term.id}>
              <Link href={pagePath("term", term.slug, term.id)} className="pw-book-term-title">{term.title}</Link>
              <span className="pw-meta">{term.perspectiveCount} 个视角</span>
              <p>{term.summary}</p>
            </li>
          ))}
        </ul>
      </BookSection>

      <BookSection id="recent-heading" title="新视角">
        <ul className="pw-book-recent">
          {recent.map(p => (
            <li key={p.id}>
              <span className="pw-meta">{p.termTitle}</span>
              <Link href={pagePath("perspective", p.slug, p.id)}>{p.title}</Link>
            </li>
          ))}
        </ul>
      </BookSection>

      <BookSection id="schools-heading" title="学派" action={<Link href="/schools">全部学派</Link>}>
        <ul className="pw-book-terms">
          {schools.slice(0, 3).map(school => (
            <li key={school.id}>
              <Link href={pagePath("school", school.slug, school.id)} className="pw-book-term-title">{school.title}</Link>
              <span className="pw-meta">{school.memberCount} 位诠释者，{school.coreTermCount} 个核心词条</span>
              <p>{school.summary}</p>
            </li>
          ))}
        </ul>
      </BookSection>
    </main>
  );
}

function BookSection({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="pw-book-section">
      <div className="pw-book-section-head">
        <h2 id={id} className="pw-display">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ───────────── 居中：字块与反白色带构成首屏，今日词条是一组从黑块伸出的色带 ───────────── */

export function MiddleHome({ terms, recent, schools, daily }: HomeData) {
  return (
    <main className="pw-home pw-middle mx-auto w-full max-w-[1408px] flex-1 px-4 pb-20 sm:px-6">
      <section className="pw-middle-hero" aria-label="探索知识">
        <h1 className="pw-display pw-middle-title">
          <span className="pw-middle-title-big">思想</span>
          <span className="pw-middle-title-band">在分歧中展开</span>
        </h1>
        <div className="pw-middle-search">
          <p>一个概念，多种视角。</p>
          <div className="relative z-10"><SearchBox size="lg" /></div>
        </div>
        {daily && (
          <div className="pw-middle-daily" aria-labelledby="daily-heading">
            <div className="pw-middle-daily-core">
              <h2 id="daily-heading" className="pw-middle-daily-label">今日词条</h2>
              <Link href={daily.href} className="pw-middle-daily-term">{daily.title}</Link>
              <span className="pw-middle-daily-count">{daily.perspectives.length} 个视角</span>
            </div>
            <span className="pw-middle-wedge" aria-hidden="true" />
            <ul className="pw-middle-rays">
              {daily.perspectives.slice(0, MAX_RAYS).map((p, i) => (
                <li key={p.id} style={{ "--i": i } as React.CSSProperties}>
                  <Link href={p.href}><strong>{p.interpreterName}</strong><span>{p.title}</span></Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <nav aria-label="三轴入口" className="pw-middle-entrances">
          <Link href="/terms">词条索引</Link>
          <Link href="/interpreters">诠释者索引</Link>
          <Link href="/schools">学派</Link>
          <Link href="/graph">图谱</Link>
        </nav>
      </section>

      <MiddleSection id="terms-heading" title="探索概念" action={<Link href="/terms">浏览全部 {terms.length} 个词条</Link>}>
        <ul className="pw-middle-terms">
          {terms.slice(0, 6).map(term => (
            <li key={term.id}>
              <span className="pw-meta">{term.perspectiveCount} 个视角</span>
              <Link href={pagePath("term", term.slug, term.id)} className="pw-middle-term-title">{term.title}</Link>
              <p>{term.summary}</p>
            </li>
          ))}
        </ul>
      </MiddleSection>

      <MiddleSection id="recent-heading" title="新视角">
        <ul className="pw-middle-recent">
          {recent.map(p => (
            <li key={p.id}>
              <strong>{p.interpreterName}</strong>
              <Link href={pagePath("perspective", p.slug, p.id)}>{p.title}</Link>
              <span className="pw-meta">{p.termTitle}</span>
            </li>
          ))}
        </ul>
      </MiddleSection>

      <MiddleSection id="schools-heading" title="学派" action={<Link href="/schools">全部学派</Link>}>
        <ul className="pw-middle-terms">
          {schools.slice(0, 3).map(school => (
            <li key={school.id}>
              <span className="pw-meta">{school.memberCount} 位诠释者</span>
              <Link href={pagePath("school", school.slug, school.id)} className="pw-middle-term-title">{school.title}</Link>
              <p>{school.summary}</p>
            </li>
          ))}
        </ul>
      </MiddleSection>
    </main>
  );
}

function MiddleSection({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="pw-middle-section">
      <div className="pw-middle-section-head">
        <h2 id={id} className="pw-display">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ───────────── 海报：斜置巨字、朱红楔形切入，今日词条是从圆心放射出去的楔形 ───────────── */

export function PosterHome({ terms, recent, schools, daily }: HomeData) {
  const rays = daily?.perspectives.slice(0, MAX_RAYS) ?? [];
  // 楔形只在右侧 ±32° 扇区内展开，文字倾角有限，仍可顺读。
  const angle = (i: number) => rays.length <= 1 ? 0 : -32 + (64 / (rays.length - 1)) * i;
  return (
    <main className="pw-home pw-poster w-full flex-1 pb-20">
      <section className="pw-poster-hero" aria-label="探索知识">
        <span className="pw-poster-wedge" aria-hidden="true" />
        <span className="pw-poster-bar" aria-hidden="true" />
        <h1 className="pw-display pw-poster-title">
          <span>思想，</span>
          <span>在分歧中</span>
          <span>展开。</span>
        </h1>
        {daily && (
          <div className="pw-poster-daily" aria-labelledby="daily-heading">
            <div className="pw-poster-disc">
              <h2 id="daily-heading" className="pw-poster-daily-label">今日词条</h2>
              <Link href={daily.href} className="pw-poster-daily-term">{daily.title}</Link>
            </div>
            <ul className="pw-poster-rays">
              {rays.map((p, i) => (
                <li key={p.id} style={{ "--a": `${angle(i)}deg`, "--i": i } as React.CSSProperties}>
                  <Link href={p.href}><strong>{p.interpreterName}</strong><span>{p.title}</span></Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <div className="pw-poster-band">
        <div className="mx-auto flex w-full max-w-[1408px] flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center">
          <p className="pw-display pw-poster-band-text">一个概念，多种视角。</p>
          <div className="relative z-10 min-w-0 flex-1"><SearchBox size="lg" /></div>
          <nav aria-label="三轴入口" className="pw-poster-entrances">
            <Link href="/terms">词条</Link>
            <Link href="/interpreters">诠释者</Link>
            <Link href="/schools">学派</Link>
          </nav>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1408px] px-4 sm:px-6">
        <PosterSection id="terms-heading" title="探索概念" action={<Link href="/terms">浏览全部 {terms.length} 个词条</Link>}>
          <ul className="pw-poster-terms">
            {terms.slice(0, 6).map(term => (
              <li key={term.id}>
                <Link href={pagePath("term", term.slug, term.id)} className="pw-poster-term-title">{term.title}</Link>
                <span className="pw-meta">{term.perspectiveCount} 个视角</span>
                <p>{term.summary}</p>
              </li>
            ))}
          </ul>
        </PosterSection>

        <PosterSection id="recent-heading" title="新视角">
          <ul className="pw-poster-recent">
            {recent.map(p => (
              <li key={p.id}>
                <strong>{p.interpreterName}</strong>
                <Link href={pagePath("perspective", p.slug, p.id)}>{p.title}</Link>
              </li>
            ))}
          </ul>
        </PosterSection>

        <PosterSection id="schools-heading" title="学派" action={<Link href="/schools">全部学派</Link>}>
          <ul className="pw-poster-terms">
            {schools.slice(0, 3).map(school => (
              <li key={school.id}>
                <Link href={pagePath("school", school.slug, school.id)} className="pw-poster-term-title">{school.title}</Link>
                <span className="pw-meta">{school.memberCount} 位诠释者</span>
                <p>{school.summary}</p>
              </li>
            ))}
          </ul>
        </PosterSection>
      </div>
    </main>
  );
}

function PosterSection({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="pw-poster-section">
      <div className="pw-poster-section-head">
        <h2 id={id} className="pw-display">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
