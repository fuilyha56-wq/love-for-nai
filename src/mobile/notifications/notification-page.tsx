"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, Image, MessageSquareReply, Trophy } from "lucide-react";
import { WorkspaceNav } from "@/mobile/workspace-nav";
import { PublicHeader } from "@/mobile/public-header";
import type { UserNotification } from "@/lib/notifications";

const icon = (type: UserNotification["type"]) => type === "announcement-reply" ? MessageSquareReply : type === "creator-reward" ? Trophy : Image;

export default function NotificationPage() {
  const [items, setItems] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [marking, setMarking] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
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
    setMarking(true);
    setMessage("");
    try {
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.message || "标记已读失败"); return; }
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
    setUnreadCount(0);
    } catch { setMessage("标记已读失败，请重试。"); }
    finally { setMarking(false); }
  }

  async function open(item: UserNotification) {
    if (!item.readAt) {
      try {
      const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id }) });
      if (response.ok) {
        const result = await response.json();
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
        setUnreadCount(Number(result.unreadCount) || 0);
      }
      } catch { /* A failed read receipt must not prevent opening the message. */ }
    }
    window.location.assign(item.href);
  }

  return <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]"><PublicHeader current="notifications" extraActions={<button type="button" onClick={() => void markAllRead()} disabled={!unreadCount || marking} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--surface-muted)] px-3 text-xs font-semibold disabled:opacity-45"><CheckCheck size={17} />全部已读</button>} /><WorkspaceNav /><section className="mx-auto max-w-4xl px-4 py-4 sm:px-7"><p className="mb-4 text-xs text-[var(--muted)]">公告回复与图库奖励按时间显示。{unreadCount > 0 && <b className="ml-1 text-[var(--rose)]">{unreadCount} 条未读</b>}</p>
    {message && <p role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{message}<button type="button" className="ml-3 min-h-11 px-3 font-semibold" onClick={() => void load()}>重试</button></p>}
    {loading ? <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] py-20 text-center text-sm text-[var(--muted)]">正在读取消息…</div> : signedIn === false ? <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] py-16 text-center"><p className="text-sm">登录后查看个人消息</p><Link href="/sign-in" className="mt-4 inline-flex rounded bg-[var(--rose)] px-4 py-2 text-xs font-semibold text-white">登录</Link></div> : !items.length ? message ? null : <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--panel)] py-20 text-center"><Bell size={28} className="mx-auto text-[var(--muted)]" /><h2 className="mt-3 text-sm font-semibold">暂时没有消息</h2><p className="mt-1 text-xs text-[var(--muted)]">有人回复你的公告评论或发放图库奖励后，会出现在这里。</p></div> : <ol className="relative space-y-3 border-l border-[var(--line)] pl-5">{items.map((item) => { const Icon = icon(item.type); return <li key={item.id} className="relative"><span className={`absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full border-2 border-[var(--paper)] ${item.readAt ? "bg-[var(--line)]" : "bg-[var(--rose)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--rose)_18%,transparent)]"}`} /><button type="button" onClick={() => void open(item)} className={`w-full rounded-lg border p-4 text-left transition-colors ${item.readAt ? "border-[var(--line)] bg-[var(--panel)]" : "border-[var(--rose)] bg-[color-mix(in_srgb,var(--rose)_5%,var(--panel))]"}`}><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--rose)_10%,var(--panel))] text-[var(--rose)]"><Icon size={17} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{item.title}</b><time className="text-xs text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</time></span><span className="mt-1 block whitespace-pre-wrap break-words text-sm leading-6 text-[var(--muted)]">{item.body}</span><span className="mt-2 inline-block text-xs font-semibold text-[var(--rose)]">查看详情 →</span></span></div></button></li>; })}</ol>}
  </section></main>;
}
