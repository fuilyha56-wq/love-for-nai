"use client";

import { LoaderCircle, Pin, RotateCcw, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownView } from "@/app/markdown";
import type { AnnouncementItem } from "@/app/announcement-dialog";
import { PublicHeader } from "@/app/public-header";

type Comment = {
  id: string;
  authorId: number;
  authorName: string;
  content: string;
  createdAt: string;
};
type LoadState = "loading" | "loaded" | "error";

export default function AnnouncementsPage() {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentLoading, setCommentLoading] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const commentRequestIds = useRef<Record<string, number>>({});

  const loadAnnouncements = useCallback(async () => {
    setLoadState("loading");
    setError("");
    try {
      const response = await fetch("/api/announcements", { cache: "no-store" });
      let result: { items?: AnnouncementItem[]; message?: string };
      try {
        result = (await response.json()) as { items?: AnnouncementItem[]; message?: string };
      } catch {
        throw new Error("公告返回了无效数据");
      }
      if (!response.ok) throw new Error(result.message || "公告读取失败");
      setItems(Array.isArray(result.items) ? result.items : []);
      setLoadState("loaded");
    } catch (loadError) {
      setError(loadError instanceof TypeError ? "公告读取失败，请检查网络后重试" : loadError instanceof Error ? loadError.message : "公告读取失败，请稍后重试");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadAnnouncements);
    fetch("/api/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => setAuthenticated(Boolean(result.authenticated)))
      .catch(() => setAuthenticated(false));
  }, [loadAnnouncements]);

  const loadComments = useCallback(async (id: string) => {
    const requestId = (commentRequestIds.current[id] || 0) + 1;
    commentRequestIds.current[id] = requestId;
    try {
      const response = await fetch(`/api/announcements/${id}/comments`, { cache: "no-store" });
      const result = await response.json();
      if (response.ok && commentRequestIds.current[id] === requestId)
        setComments((current) => ({ ...current, [id]: result.items || [] }));
    } catch {
      // 评论读取失败不影响公告正文。
    }
  }, []);

  useEffect(() => {
    if (items[0]) void Promise.resolve().then(() => loadComments(items[0].id));
  }, [items, loadComments]);

  function toggle(id: string, open: boolean) {
    setExpanded(open ? "" : id);
    if (!open && !comments[id]) void loadComments(id);
  }

  async function submitComment(id: string) {
    const content = commentDrafts[id]?.trim() || "";
    if (!content) return;
    setCommentLoading(id);
    setMessage("");
    try {
      const response = await fetch(`/api/announcements/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "评论发布失败");
        return;
      }
      // 使在途 GET 失效，避免旧响应把刚发布的评论覆盖掉。
      commentRequestIds.current[id] = (commentRequestIds.current[id] || 0) + 1;
      setComments((current) => ({ ...current, [id]: [...(current[id] || []), result.item] }));
      setCommentDrafts((current) => ({ ...current, [id]: "" }));
    } catch {
      setMessage("评论发布失败，请稍后重试");
    } finally {
      setCommentLoading(null);
    }
  }

  const latest = items[0];

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader current="announcements" />
      <section className="mx-auto max-w-3xl p-4 sm:p-7">
        {message && <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
        {loadState === "error" ? (
          <div className="py-24 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button type="button" onClick={() => void loadAnnouncements()} className="mt-4 inline-flex h-9 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold hover:border-[var(--rose)]">
              <RotateCcw size={15} />重试
            </button>
          </div>
        ) : loadState === "loading" ? (
          <p className="py-24 text-center text-sm text-[var(--muted)]">正在加载公告…</p>
        ) : !items.length ? (
          <p className="py-24 text-center text-sm text-[var(--muted)]">暂无公告</p>
        ) : (

          <ol className="relative space-y-5 border-l-2 border-[var(--line)] pl-6">
            {items.map((item) => {
              const open = expanded === null ? item.id === latest?.id : expanded === item.id;
              const itemComments = comments[item.id] || [];
              return (
                <li key={item.id} className="relative">
                  <span className={`absolute -left-[31px] top-1.5 grid h-4 w-4 place-items-center rounded-full border-2 ${item.pinned ? "border-[var(--rose)] bg-[var(--rose)]" : "border-[var(--line)] bg-white"}`} />
                  <article className={`overflow-hidden rounded-lg border bg-white ${item.level === "warning" ? "border-amber-300" : "border-[var(--line)]"}`}>
                    <button type="button" onClick={() => toggle(item.id, open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                      <span className="flex min-w-0 items-center gap-2">
                        {item.pinned && <Pin size={13} className="shrink-0 text-[var(--rose)]" />}
                        <b className="truncate">{item.title}</b>
                        {item.level === "warning" && <span className="shrink-0 rounded-full bg-[#fff3d6] px-2 py-0.5 text-[10px] font-semibold text-[#8a6116]">重要</span>}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleDateString("zh-CN")}</span>
                    </button>
                    {open && (
                      <div className="border-t border-[var(--line)] px-4 py-4">
                        <MarkdownView content={item.content} />
                        <p className="mt-3 text-[10px] text-[var(--muted)]">发布：{item.author} · 更新于 {new Date(item.updatedAt || item.createdAt).toLocaleString("zh-CN")}</p>
                        <section className="mt-5 border-t border-[var(--line)] pt-4">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-xs font-semibold">社区反馈 · {itemComments.length} 条</h3>
                            {!authenticated && <Link href="/sign-in" className="text-[10px] text-[var(--rose)] hover:underline">登录后留言</Link>}
                          </div>
                          <div className="mt-3 space-y-2">
                            {itemComments.map((comment) => (
                              <div key={comment.id} className="rounded border border-[var(--line)] bg-[#faf9f5] px-3 py-2.5">
                                <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--muted)]"><b className="text-[var(--ink)]">{comment.authorName}</b><time>{new Date(comment.createdAt).toLocaleString("zh-CN")}</time></div>
                                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5">{comment.content}</p>
                              </div>
                            ))}
                            {!itemComments.length && <p className="text-xs text-[var(--muted)]">还没有反馈，欢迎留下第一条建议。</p>}
                          </div>
                          {authenticated && (
                            <div className="mt-3 flex gap-2">
                              <textarea value={commentDrafts[item.id] || ""} onChange={(event) => setCommentDrafts((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={2000} rows={2} placeholder="写下你的 UI 或功能建议…" className="field min-h-16 flex-1 resize-y p-2 text-xs" />
                              <button type="button" onClick={() => submitComment(item.id)} disabled={commentLoading === item.id || !(commentDrafts[item.id] || "").trim()} className="flex h-9 shrink-0 items-center gap-1.5 self-end rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                                {commentLoading === item.id ? <LoaderCircle size={13} className="animate-spin" /> : <Send size={13} />}发布
                              </button>
                            </div>
                          )}
                        </section>
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
