"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const NOTIFICATIONS_CHANGED = "phoskywiki:notifications-changed";

/** 根布局在站内导航时会被复用，未读数量需要独立刷新。 */
export function NotificationLink({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const pathname = usePathname();

  useEffect(() => {
    let controller: AbortController | undefined;
    async function refresh() {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/notifications/unread-count", {
          cache: "no-store", signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          setCount(data.unreadCount);
        }
      } catch {
        // 网络恢复或下一次导航时重试，保留已知数量。
      }
    }
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
    };
  }, [pathname]);

  return (
    <Link href="/profile#notifications" className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      {count > 0 ? `通知（${count} 条未读）` : "通知"}
    </Link>
  );
}
