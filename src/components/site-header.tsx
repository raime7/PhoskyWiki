import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { NotificationLink } from "@/components/notification-link";
import { SearchBox } from "@/components/search-box";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { getSessionUser } from "@/lib/session";
import type { UserRole } from "@/db/schema";

// TODO(列表页工单): 诠释者列表页落地后替换占位链接；词条暂以首页词条列表为入口
const navItems = [
  { href: "/#terms", label: "词条" },
  { href: "/", label: "诠释者" },
  { href: "/schools", label: "学派" },
  { href: "/categories", label: "分类" },
  { href: "/graph", label: "图谱" },
  { href: "/search", label: "搜索" },
  { href: "/interests", label: "兴趣" },
];

const roleLabels: Record<UserRole, string> = {
  editor: "编者",
  admin: "管理员",
  // trusted 是二期「免审编者」的预留位，一期按下不表
  trusted: "编者",
};

export async function SiteHeader() {
  const user = await getSessionUser();
  const unreadCount = user ? await getUnreadNotificationCount(user.id) : 0;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
        <Link href="/" className="shrink-0 text-lg font-bold tracking-tight">
          PhoskyWiki
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="order-last w-full sm:order-none sm:w-64">
          <SearchBox />
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2 text-sm">
          {user ? (
            <>
              <ButtonLikeLink href="/new/term">创建词条</ButtonLikeLink>
              <ButtonLikeLink href="/new/interpreter">新诠释者</ButtonLikeLink>
              {user.role === "admin" && <ButtonLikeLink href="/review">审核队列</ButtonLikeLink>}
              {user.role === "admin" && <ButtonLikeLink href="/admin/deleted">已删除页面</ButtonLikeLink>}
              <NotificationLink key={user.id} initialCount={unreadCount} />
              <Link href="/profile" data-testid="session-user" className="min-w-0 break-words text-muted-foreground hover:text-foreground">
                {user.name}
                <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {roleLabels[user.role]}
                </span>
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <ButtonLikeLink href="/login">登录</ButtonLikeLink>
              <ButtonLikeLink href="/register">注册</ButtonLikeLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function ButtonLikeLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </Link>
  );
}
