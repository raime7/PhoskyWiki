import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { PageContainer } from "@/components/page-container";
import { SearchBox } from "@/components/search-box";
import { listRecentPerspectives, listSchools, listTerms } from "@/lib/content";
import { getDailyTerm, type DailyTerm } from "@/lib/daily-term";
import { getInterestTags } from "@/lib/interests";
import { hasAnyInterest } from "@/lib/interest-tags";
import { listHomeRecommendations } from "@/lib/recommend";
import { getSessionUser } from "@/lib/session";
import { pagePath } from "@/lib/slug";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

// 今日词条最多放射出的视角数；其余由"另有 N 个视角"进入词条页。
const MAX_RAYS = 6;

export default async function Home() {
  const [terms, recent, schools, user, daily] = await Promise.all([
    listTerms(), listRecentPerspectives(), listSchools(), getSessionUser(), getDailyTerm(),
  ]);
  const interests = user ? await getInterestTags(user.id) : null;
  const recommendations = interests ? await listHomeRecommendations(interests) : [];

  return (
    <main className="w-full flex-1 pb-20">
      {/* 首屏是一张海报（ADR-0008）：斜置标语、朱红楔形，今日词条画成从圆心放射的视角。
          检索带在 DOM 里紧跟标语，窄屏时仍落在首屏；宽屏时标语与今日词条并排，检索带通栏压底。 */}
      <section className={styles.poster} aria-label="探索知识">
        <div className={styles.decor} aria-hidden="true">
          <span className={styles.wedge} />
          <span className={styles.bar} />
        </div>
        <h1 className={styles.title}>
          <span className={styles.kicker}>只有</span>
          <span>改变过去，</span>
          <span className={styles.band}>才能创造</span>
          <span>新的未来</span>
        </h1>
        <div className={styles.searchBand}>
          <p className={styles.searchBandText}>一个概念，多种视角。</p>
          <div className="relative z-10 min-w-0 flex-1"><SearchBox size="lg" /></div>
          <nav aria-label="三轴入口" className={styles.entrances}>
            <Link href="/terms">词条索引</Link>
            <Link href="/interpreters">诠释者索引</Link>
            <Link href="/schools">学派入口</Link>
          </nav>
        </div>
        {daily && <DailyConstruction daily={daily} />}
      </section>

      <PageContainer className="max-w-[1408px] py-0">
        <HomeSection id="terms-heading" title="探索概念" action={<Link href="/terms">浏览全部 {terms.length} 个词条</Link>}>
          <ul className={styles.cards}>
            {terms.slice(0, 6).map(term => (
              <li key={term.id}>
                <Link href={pagePath("term", term.slug, term.id)} className={styles.cardTitle}>{term.title}</Link>
                <span className={styles.meta}>{term.perspectiveCount} 个视角</span>
                <p>{term.summary}</p>
              </li>
            ))}
          </ul>
          {terms.length === 0 && <p className="text-muted-foreground">还没有词条，欢迎参与共建。</p>}
        </HomeSection>

        {user && (
          <HomeSection id="for-you-heading" title="为你发现" action={
            <Link href="/interests">{interests && hasAnyInterest(interests) ? "调整兴趣标签" : "设置兴趣标签"}</Link>
          }>
            <p className="font-serif text-muted-foreground">{recommendations.length > 0
              ? "根据你关注的诠释者、学派与主题，继续探索这些词条。"
              : interests && hasAnyInterest(interests)
                ? "暂时没有匹配你兴趣的词条，可以调整兴趣或浏览“探索概念”栏目。"
                : "选择感兴趣的诠释者、学派与主题，找到下一步的阅读方向。"}</p>
            {recommendations.length > 0 && (
              <ul className={`${styles.cards} mt-6`}>
                {recommendations.map(term => (
                  <li key={term.id}>
                    {/* 匹配数放在链接里：与"探索概念"里同名词条的链接各有其名 */}
                    <Link href={pagePath("term", term.slug, term.id)} className={styles.recommendation}>
                      <span className={styles.cardTitle}>{term.title}</span>{" "}
                      <span className={styles.meta}>{term.interestMatchCount} 项兴趣匹配</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </HomeSection>
        )}

        <HomeSection id="recent-heading" title="新视角">
          <ul className={styles.recent}>
            {recent.map(perspective => (
              <li key={perspective.id}>
                <strong>{perspective.interpreterName}</strong>
                <Link href={pagePath("perspective", perspective.slug, perspective.id)}>{perspective.title}</Link>
                <span className={styles.meta}>{perspective.termTitle}</span>
              </li>
            ))}
          </ul>
          {recent.length === 0 && <p className="text-muted-foreground">还没有发布的视角。</p>}
        </HomeSection>

        <HomeSection id="schools-heading" title="学派巡礼" action={<Link href="/schools">探索全部学派</Link>}>
          <ul className={styles.cards}>
            {schools.slice(0, 3).map(school => (
              <li key={school.id}>
                <Link href={pagePath("school", school.slug, school.id)} className={styles.cardTitle}>{school.title}</Link>
                <span className={styles.meta}>{school.memberCount} 位诠释者，{school.coreTermCount} 个核心词条</span>
                <p>{school.summary}</p>
              </li>
            ))}
          </ul>
          {schools.length === 0 && <p className="text-muted-foreground">还没有学派，欢迎参与共建。</p>}
        </HomeSection>
      </PageContainer>
    </main>
  );
}

/** 一个词条 → 多个视角的构成：圆心是词条，同形同色的楔形色带是各视角（平等并列）。 */
function DailyConstruction({ daily }: { daily: DailyTerm }) {
  const rays = daily.perspectives.slice(0, MAX_RAYS);
  // 色带只在右侧 ±32° 扇区内展开，文字倾角有限，仍可顺读。
  const angle = (i: number) => rays.length <= 1 ? 0 : -32 + (64 / (rays.length - 1)) * i;
  const more = daily.perspectives.length - rays.length;
  return (
    <section className={styles.daily} aria-labelledby="daily-heading">
      <div className={styles.disc}>
        <h2 id="daily-heading" className={styles.dailyLabel}>今日词条</h2>
        <Link href={daily.href} className={styles.dailyTerm} aria-label={`今日词条：${daily.title}`}>{daily.title}</Link>
        {more > 0 && <Link href={daily.href} className={styles.dailyMore}>另有 {more} 个视角</Link>}
      </div>
      <ul className={styles.rays} aria-label={`${daily.title}的视角`}>
        {rays.map((p, i) => (
          <li key={p.id} style={{ "--a": `${angle(i)}deg`, "--i": i } as CSSProperties}>
            <Link href={p.href} aria-label={`${p.interpreterName}：${p.title}`}><strong>{p.interpreterName}</strong><span>{p.title}</span></Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HomeSection({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id={id}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
