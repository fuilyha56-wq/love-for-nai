"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications?limit=1", { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json();
      setUnreadCount(Number(result.unreadCount) || 0);
    } catch { /* 连接恢复后轮询会重新读取。 */ }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
    const timer = window.setInterval(load, 20_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);
  return <Link href="/notifications" aria-label={unreadCount ? `消息，有 ${unreadCount} 条未读` : "消息"} title="站内消息" className={`relative flex h-9 items-center gap-2 rounded border px-3 text-xs font-semibold transition-colors ${unreadCount ? "border-[var(--rose)] bg-[color-mix(in_srgb,var(--rose)_9%,white)] text-[var(--rose)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--rose)_12%,transparent)]" : "border-[var(--line)] bg-white text-[var(--ink)]"}`}>
    <Bell size={16} className={unreadCount ? "animate-pulse" : ""} /><span className="hidden sm:inline">消息</span>{unreadCount > 0 && <span className="min-w-5 rounded-full bg-[var(--rose)] px-1.5 py-0.5 text-center text-[10px] leading-4 text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
  </Link>;
}
