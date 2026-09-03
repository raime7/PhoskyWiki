import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 px-4 py-24">
      <h1 className="text-4xl font-bold tracking-tight">PhoskyWiki</h1>
      <p className="max-w-xl text-center text-lg text-muted-foreground">
        每个词条是一个聚合枢纽，其下聚合各诠释者的视角。
        在这里，同一概念的不同立场叙述并列可见。
      </p>
      <div className="flex gap-6 text-sm text-muted-foreground">
        <span>词条 × 视角</span>
        <span>·</span>
        <span>三轴导航</span>
        <span>·</span>
        <span>双链与图谱</span>
      </div>
      <Button asChild size="lg">
        <Link href="/">开始浏览</Link>
      </Button>
    </main>
  );
}
