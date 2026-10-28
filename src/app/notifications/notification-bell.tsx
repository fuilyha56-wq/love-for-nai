"use client";

import Link from "next/link";
import { useNotifications } from "@/app/notifications/use-notifications";
import { Bell } from "lucide-react";

export function NotificationBell() {
  const { unreadCount } = useNotifications(1);
  return <Link href="/notifications" aria-label={unreadCount ? `消息，有 ${unreadCount} 条未读` : "消息"} title="站内消息" className={`relative flex h-9 items-center gap-2 rounded border px-3 text-xs font-semibold transition-colors ${unreadCount ? "border-[var(--rose)] bg-[color-mix(in_srgb,var(--rose)_9%,white)] text-[var(--rose)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--rose)_12%,transparent)]" : "border-[var(--line)] bg-white text-[var(--ink)]"}`}>
    <Bell size={16} className={unreadCount ? "animate-pulse" : ""} /><span className="hidden sm:inline">消息</span>{unreadCount > 0 && <span className="min-w-5 rounded-full bg-[var(--rose)] px-1.5 py-0.5 text-center text-[10px] leading-4 text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
  </Link>;
}
