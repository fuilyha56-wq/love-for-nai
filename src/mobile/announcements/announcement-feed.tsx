"use client";
import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Pin, RotateCcw } from "lucide-react";
import type { AnnouncementItem } from "@/mobile/announcement-dialog";
import { DiscussionComments } from "@/mobile/gallery/discussion-comments";

export function AnnouncementFeed({ header, navigation, Content }: { header: ReactNode; navigation: ReactNode; Content: ComponentType<{ content: string }> }) {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/announcements", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "公告读取失败");
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) { setError(error instanceof Error ? error.message : "公告读取失败，请稍后重试"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
    const id = new URLSearchParams(window.location.search).get("announcement");
    if (id) void Promise.resolve().then(() => setExpanded(id));
  }, [load]);
  return <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">{header}{navigation}
    <section className="mx-auto max-w-4xl px-4 py-6 sm:px-7">
      <header className="mb-6 flex items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">站点公告</h1><p className="mt-2 text-sm text-[var(--muted)]">查看更新、分享建议，与大家交流。</p></div><button type="button" className="flex min-h-11 items-center gap-2 text-sm" disabled={loading} onClick={() => void load()}><RotateCcw size={16} />刷新</button></header>
      {error && <p role="alert" className="mb-4 text-sm text-[var(--rose)]">{error}</p>}
      {loading ? <p role="status" className="py-20 text-center text-sm text-[var(--muted)]">正在加载公告…</p> : !items.length ? <p className="py-20 text-center text-sm text-[var(--muted)]">暂无公告</p> : <ol className="space-y-5">{items.map((item, index) => {
        const open = expanded === null ? index === 0 : expanded === item.id;
        return <li key={item.id}><article className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
          <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? "" : item.id)} className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 text-left"><span className="flex min-w-0 items-center gap-2">{item.pinned && <Pin size={15} className="shrink-0 text-[var(--rose)]" />}<b className="truncate">{item.title}</b>{item.level === "warning" && <span className="text-xs text-[var(--rose)]">重要</span>}</span><time className="shrink-0 text-xs text-[var(--muted)]">{new Date(item.createdAt).toLocaleDateString("zh-CN")}</time></button>
          {open && <div className="border-t border-[var(--line)] p-4"><Content content={item.content} /><p className="mt-4 text-xs text-[var(--muted)]">{item.author} · {new Date(item.createdAt).toLocaleString("zh-CN")}</p><DiscussionComments resource="announcements" resourceId={item.id} /></div>}
        </article></li>;
      })}</ol>}
    </section>
  </main>;
}
