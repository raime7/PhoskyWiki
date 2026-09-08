import type { Metadata } from "next";
import Link from "next/link";

import { InterestTagManager } from "@/components/interest-tag-manager";
import { getInterestOptions, getInterestTags } from "@/lib/interests";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "兴趣标签" };

export default async function InterestsPage() {
  const user = await getSessionUser();
  const [options, accountInterests] = await Promise.all([
    getInterestOptions(),
    user ? getInterestTags(user.id) : Promise.resolve(null),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <nav aria-label="面包屑" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          首页
        </Link>
        <span className="mx-1.5">/</span>
        <span aria-current="page">兴趣标签</span>
      </nav>

      <h1 className="text-3xl font-bold tracking-tight">兴趣标签</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        选择你关注的诠释者、学派与主题（分类）：词条页的视角列表会把相关诠释者排前，
        相关词条推荐也会优先呈现兴趣所在。
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {user ? (
          <>
            兴趣随账号同步，换设备不丢；保存时会把本浏览器此前的本地选择一并并入。
            当前选择也可以在<Link href="/profile" className="text-foreground underline-offset-4 hover:underline">个人主页</Link>查看。
          </>
        ) : (
          <>
            未登录：选择只保存在本浏览器（localStorage），视角重排即时跟随你选的诠释者；
            注册登录并保存后，学派与主题也一并参与个性化。
          </>
        )}
      </p>

      <section aria-labelledby="interest-picker-heading" className="mt-8">
        <h2 id="interest-picker-heading" className="text-xl font-semibold">
          选择兴趣
        </h2>
        <div className="mt-4">
          <InterestTagManager
            mode={user ? "account" : "guest"}
            interpreters={options.interpreters.map((row) => ({ id: row.id, label: row.name }))}
            schools={options.schools.map((row) => ({ id: row.id, label: row.name }))}
            categories={options.categories.map((row) => ({
              id: row.id,
              label: row.name,
              note: row.parentName ?? undefined,
            }))}
            accountInterests={accountInterests ?? undefined}
          />
        </div>
      </section>
    </main>
  );
}
