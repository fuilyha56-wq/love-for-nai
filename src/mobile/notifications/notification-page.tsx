"use client";

import Link from "next/link";
import { useNotifications } from "@/app/notifications/use-notifications";
import { ArrowLeft, Bell, CheckCheck, Image, MessageSquareReply, Trophy } from "lucide-react";
import { WorkspaceNav } from "@/mobile/workspace-nav";
import { PublicHeader } from "@/mobile/public-header";
import type { UserNotification } from "@/lib/notifications";

const icon = (type: UserNotification["type"]) => ["announcement-reply", "gallery-comment", "gallery-reply", "comment-like"].includes(type) ? MessageSquareReply : type === "creator-reward" ? Trophy : Image;

export default function NotificationPage() {
  const { items, unreadCount, loading, signedIn, message, marking, refresh, markRead } = useNotifications();

  async function open(item: UserNotification) {
    if (!item.readAt && !(await markRead(item.id))) return;
    window.location.assign(item.href);
  }

  return <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]"><PublicHeader current="notifications" extraActions={<button type="button" onClick={() => void markRead()} disabled={!unreadCount || marking} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--surface-muted)] px-3 text-xs font-semibold disabled:opacity-45"><CheckCheck size={17} />全部已读</button>} /><WorkspaceNav /><section className="mx-auto max-w-4xl px-4 py-4 sm:px-7"><Link replace href="/image" className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-[var(--muted)]"><ArrowLeft size={18} />返回生成页面</Link><p className="mb-4 text-xs text-[var(--muted)]">公告回复与图库奖励按时间显示。{unreadCount > 0 && <b className="ml-1 text-[var(--rose)]">{unreadCount} 条未读</b>}</p>
    {message && <p role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{message}<button type="button" className="ml-3 min-h-11 px-3 font-semibold" onClick={() => void refresh()}>重试</button></p>}
    {loading ? <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] py-20 text-center text-sm text-[var(--muted)]">正在读取消息…</div> : signedIn === false ? <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] py-16 text-center"><p className="text-sm">登录后查看个人消息</p><Link href="/sign-in" className="mt-4 inline-flex rounded bg-[var(--rose)] px-4 py-2 text-xs font-semibold text-white">登录</Link></div> : !items.length ? message ? null : <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--panel)] py-20 text-center"><Bell size={28} className="mx-auto text-[var(--muted)]" /><h2 className="mt-3 text-sm font-semibold">暂时没有消息</h2><p className="mt-1 text-xs text-[var(--muted)]">你发表的评论、收到的评论回复和奖励，会出现在这里。</p></div> : <ol className="relative space-y-3 border-l border-[var(--line)] pl-5">{items.map((item) => { const Icon = icon(item.type); return <li key={item.id} className="relative"><span className={`absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full border-2 border-[var(--paper)] ${item.readAt ? "bg-[var(--line)]" : "bg-[var(--rose)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--rose)_18%,transparent)]"}`} /><button type="button" onClick={() => void open(item)} className={`w-full rounded-lg border p-4 text-left transition-colors ${item.readAt ? "border-[var(--line)] bg-[var(--panel)]" : "border-[var(--rose)] bg-[color-mix(in_srgb,var(--rose)_5%,var(--panel))]"}`}><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--rose)_10%,var(--panel))] text-[var(--rose)]"><Icon size={17} /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{item.title}</b><time className="text-xs text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</time></span><span className="mt-1 block whitespace-pre-wrap break-words text-sm leading-6 text-[var(--muted)]">{item.body}</span><span className="mt-2 inline-block text-xs font-semibold text-[var(--rose)]">查看详情 →</span></span></div></button></li>; })}</ol>}
  </section></main>;
}
