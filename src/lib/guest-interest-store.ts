"use client";

// 游客兴趣的读取钩子（T12）：localStorage 是 React 之外的外部系统——
// useSyncExternalStore 在 SSR 与水合首帧一律取 null 的服务端快照，水合后才切到
// 客户端快照（等价于「延后到 hydration 之后读取」，避免服务端/客户端不一致），
// 且跨标签页的 storage 事件自动触发重读。

import { useMemo, useSyncExternalStore } from "react";

import { INTEREST_STORAGE_KEY, parseStoredInterestSet, writeGuestInterests, type InterestSet } from "@/lib/interest-tags";

const CHANGE_EVENT = "phoskywiki:interests-changed";

/** 保存成功后同时通知本页订阅者；storage 事件只负责其他标签页。 */
export function persistGuestInterests(set: InterestSet): boolean {
  try {
    writeGuestInterests(window.localStorage, set);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function readSnapshot(): string | null {
  try { return window.localStorage.getItem(INTEREST_STORAGE_KEY); }
  catch { return null; }
}

function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** 本浏览器保存的游客兴趣；没有（或损坏）时为 null。 */
export function useGuestInterests(): InterestSet | null {
  const raw = useSyncExternalStore(
    subscribeToStorage,
    readSnapshot,
    () => null,
  );
  return useMemo(() => parseStoredInterestSet(raw), [raw]);
}
