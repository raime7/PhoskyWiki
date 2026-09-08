"use client";

// 游客兴趣的读取钩子（T12）：localStorage 是 React 之外的外部系统——
// useSyncExternalStore 在 SSR 与水合首帧一律取 null 的服务端快照，水合后才切到
// 客户端快照（等价于「延后到 hydration 之后读取」，避免服务端/客户端不一致），
// 且跨标签页的 storage 事件自动触发重读。

import { useSyncExternalStore } from "react";

import { INTEREST_STORAGE_KEY, parseStoredInterestSet, type InterestSet } from "@/lib/interest-tags";

function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** 本浏览器保存的游客兴趣；没有（或损坏）时为 null。 */
export function useGuestInterests(): InterestSet | null {
  const raw = useSyncExternalStore(
    subscribeToStorage,
    () => window.localStorage.getItem(INTEREST_STORAGE_KEY),
    () => null,
  );
  return parseStoredInterestSet(raw);
}
