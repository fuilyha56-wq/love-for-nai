"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bell, CheckCheck, Image, MessageSquareReply, Trophy } from "lucide-react";
import { WorkspaceNav } from "@/app/workspace-nav";
import { PublicHeader } from "@/app/public-header";
import type { UserNotification } from "@/lib/notifications";

const icon = (type: UserNotification["type"]) => type === "announcement-reply" ? MessageSquareReply : type === "creator-reward" ? Trophy : Image;

export default function NotificationPage() {
  const [items, setItems] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (response.status === 401) { setSignedIn(false); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "消息读取失败");
      setSignedIn(true); setItems(Array.isArray(result.items) ? result.items : []); setUnreadCount(Number(result.unreadCount) || 0);
    } catch (error) { setMessage(error instanceof Error ? error.message : "消息读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function markAllRead() {
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.message || "标记已读失败"); return; }
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
    setUnreadCount(0);
  }

  async function open(item: UserNotification) {
    if (!item.readAt) {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
      if (response.ok) {
        const result = await response.json();
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
        setUnreadCount(Number(result.unreadCount) || 0);
      }
    }
    window.location.assign(item.href);
  }

  return <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]"><PublicHeader current="announcements" /><WorkspaceNav /><section className="mx-auto max-w-4xl px-4 py-8 sm:px-7">
    <div className="mb-6 flex items-center justify-between gap-4"><div><Link href="/image" className="mb-3 inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--rose)]"><ArrowLeft size={14} />返回图像工作台</Link><h1 className="flex items-center gap-2 text-2xl font-bold"><Bell className="text-[var(--rose)]" />消息</h1><p className="mt-1 text-xs text-[var(--muted)]">公告回复与图库奖励会按时间显示在这里。{unreadCount > 0 && <b className="ml-1 text-[var(--rose)]">{unreadCount} 条未读</b>}</p></div><button type="button" onClick={() => void markAllRead()} disabled={!unreadCount} className="inline-flex h-9 shrink-0 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold disabled:opacity-45"><CheckCheck size={15} />全部已读</button></div>
    {message && <p role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
    {loading ? <div className="rounded-xl border border-[var(--line)] bg-white py-20 text-center text-sm text-[var(--muted)]">正在读取消息…</div> : signedIn === false ? <div className="rounded-xl border border-[var(--line)] bg-white py-16 text-center"><p className="text-sm">登录后查看个人消息</p><Link href="/sign-in" className="mt-4 inline-flex rounded bg-[var(--rose)] px-4 py-2 text-xs font-semibold text-white">登录</Link></div> : !items.length ? <div className="rounded-xl border border-dashed border-[var(--line)] bg-white py-20 text-center"><Bell size={28} className="mx-auto text-[var(--muted)]" /><h2 className="mt-3 text-sm font-semibold">暂时没有消息</h2><p className="mt-1 text-xs text-[var(--muted)]">有人回复你的公告评论或发放图库奖励后，会出现在这里。</p></div> : <ol className="relative space-y-3 border-l border-[var(--line)] pl-5">{items.map((item) => { const Icon = icon(item.type); return <li key={item.id} className="relative"><span className={`absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full border-2 border-[var(--paper)] ${item.readAt ? "bg-[var(--line)]" : "bg-[var(--rose)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--rose)_18%,transparent)]"}`} /><button type="button" onClick={() => void open(item)} className={`w-full rounded-lg border p-4 text-left transition-colors ${item.readAt ? "border-[var(--line)] bg-white" : "border-[var(--rose)] bg-[color-mix(in_srgb,var(--rose)_5%,white)]"}`}><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--rose)_10%,white)] text-[var(--rose)]"><Icon size={17} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{item.title}</b><time className="text-[10px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</time></span><span className="mt-1 block whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{item.body}</span><span className="mt-2 inline-block text-[10px] font-semibold text-[var(--rose)]">查看详情 →</span></span></div></button></li>; })}</ol>}
  </section></main>;
}
