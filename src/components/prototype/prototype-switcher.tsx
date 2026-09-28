"use client";

// PROTOTYPE：浮动变体切换条（一次性代码，生产构建不渲染）。
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

import { PROTO_COOKIE, PROTO_VARIANTS, type ProtoVariant } from "./variants";

export function PrototypeSwitcher({ current }: { current: ProtoVariant }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const index = PROTO_VARIANTS.findIndex(v => v.key === current);

  const go = useCallback((key: ProtoVariant) => {
    document.cookie = `${PROTO_COOKIE}=${key}; path=/; max-age=31536000; samesite=lax`;
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", key);
    router.replace(`${pathname}?${params}`, { scroll: false });
    router.refresh();
  }, [pathname, router, searchParams]);

  // 分享链接带 ?variant= 进来时，把它同步进 cookie，让页头等布局层也切过去。
  const fromUrl = searchParams.get("variant");
  useEffect(() => {
    if (fromUrl && fromUrl !== current && PROTO_VARIANTS.some(v => v.key === fromUrl)) go(fromUrl as ProtoVariant);
  }, [fromUrl, current, go]);

  const step = useCallback((delta: number) => {
    const next = PROTO_VARIANTS[(index + delta + PROTO_VARIANTS.length) % PROTO_VARIANTS.length]!;
    go(next.key);
  }, [index, go]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  return (
    <div
      role="group"
      aria-label="原型变体切换"
      data-prototype-switcher
      style={{ fontFamily: "system-ui, sans-serif" }}
      className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#2b2b2b] p-1 text-sm text-white shadow-[0_6px_24px_rgb(0_0_0/0.35)]"
    >
      <button type="button" aria-label="上一个变体" onClick={() => step(-1)} className="grid size-9 place-items-center rounded-full hover:bg-white/15"><ChevronLeft className="size-4" aria-hidden="true" /></button>
      <span className="min-w-36 px-2 text-center tabular-nums">原型 {index + 1}/{PROTO_VARIANTS.length} · {PROTO_VARIANTS[index]!.label}</span>
      <button type="button" aria-label="下一个变体" onClick={() => step(1)} className="grid size-9 place-items-center rounded-full hover:bg-white/15"><ChevronRight className="size-4" aria-hidden="true" /></button>
    </div>
  );
}
