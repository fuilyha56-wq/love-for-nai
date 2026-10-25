"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { MessageSquareReply, Pin, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { MarkdownView } from "@/app/markdown";
import type { AnnouncementItem } from "@/app/announcement-dialog";

type AdminComment = {
  id: string;
  announcementId: string;
  parentId: string | null;
  authorId: number;
  authorName: string;
  content: string;
  createdAt: string;
  pinned: boolean;
  likes: number;
  dislikes: number;
  myVote: "up" | "down" | null;
};

export default function CommentsDialog({
  announcement,
  onClose,
  setMessage,
}: {
  announcement: AnnouncementItem;
  onClose: () => void;
  setMessage: (text: string) => void;
}) {
  const [items, setItems] = useState<AdminComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/announcements/${announcement.id}/comments`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "评论读取失败");
      setItems(result.items || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "评论读取失败");
    } finally {
      setLoading(false);
    }
  }, [announcement.id, setMessage]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function update(commentId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/announcements/${announcement.id}/comments`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId, ...body }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "操作失败");
    setItems((current) => current.map((item) => item.id === commentId ? result.item : item));
  }

  async function vote(item: AdminComment, voteType: "up" | "down") {
    try { await update(item.id, { action: "vote", vote: item.myVote === voteType ? null : voteType }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "投票失败"); }
  }

  async function pin(item: AdminComment) {
    try { await update(item.id, { action: "pin", pinned: !item.pinned }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "置顶操作失败"); }
  }

  async function remove(commentId: string) {
    try {
      const response = await fetch(`/api/announcements/${announcement.id}/comments/${commentId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "删除失败");
      const deletedIds = new Set<string>(result.deletedIds || [commentId]);
      setItems((current) => current.filter((item) => !deletedIds.has(item.id)));
      setMessage(`评论及 ${Math.max(0, deletedIds.size - 1)} 条回复已删除`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); }
  }

  async function submitReply(parentId: string | null) {
    if (!replyDraft.trim()) return;
    setSending(true);
    try {
      const response = await fetch(`/api/announcements/${announcement.id}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyDraft, ...(parentId ? { parentId } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "回复发布失败");
      setItems((current) => [...current, result.item]);
      setReplyDraft(""); setReplyTarget(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "回复发布失败"); }
    finally { setSending(false); }
  }

  function renderComment(item: AdminComment, depth = 0): ReactNode {
    const children = items.filter((entry) => entry.parentId === item.id);
    return <div key={item.id} className={`rounded border bg-[#faf9f5] p-3 ${item.pinned ? "border-[var(--rose)]" : "border-[var(--line)]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs font-semibold">{item.authorName}{item.pinned && <span className="inline-flex items-center gap-1 text-[10px] text-[var(--rose)]"><Pin size={11} />已置顶</span>}</span><time className="text-[10px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</time></div>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5">{item.content}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px]">
        <button type="button" onClick={() => void vote(item, "up")} className={`inline-flex items-center gap-1 ${item.myVote === "up" ? "text-[var(--rose)]" : "text-[var(--muted)]"}`}><ThumbsUp size={12} />{item.likes}</button>
        <button type="button" onClick={() => void vote(item, "down")} className={`inline-flex items-center gap-1 ${item.myVote === "down" ? "text-[var(--rose)]" : "text-[var(--muted)]"}`}><ThumbsDown size={12} />{item.dislikes}</button>
        <button type="button" onClick={() => { setReplyTarget(replyTarget === item.id ? null : item.id); setReplyDraft(""); }} className="inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--rose)]"><MessageSquareReply size={12} />回复</button>
        <button type="button" onClick={() => void pin(item)} className="text-[var(--rose)] hover:underline">{item.pinned ? "取消置顶" : "置顶"}</button>
        <button type="button" onClick={() => void remove(item.id)} className="text-red-600 hover:underline">删除{children.length ? `（含 ${children.length} 条直接回复）` : ""}</button>
      </div>
      {replyTarget === item.id && <div className="mt-2 flex gap-2"><textarea autoFocus value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} rows={2} maxLength={2000} placeholder={`回复 ${item.authorName}…`} className="field min-h-14 flex-1 resize-y p-2 text-xs" /><button type="button" onClick={() => void submitReply(item.id)} disabled={sending || !replyDraft.trim()} className="flex h-8 items-center gap-1 self-end rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50"><Send size={12} />发送</button></div>}
      {children.length > 0 && depth < 8 && <div className="mt-3 space-y-2 border-l border-[var(--line)] pl-3">{children.map((child) => renderComment(child, depth + 1))}</div>}
    </div>;
  }

  return (
    <div className="fixed inset-0 z-[30000] grid place-items-center bg-[#202328]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[#fffefa] shadow-[0_24px_80px_rgba(50,45,40,.25)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[#f5f3ed] px-5 py-4">
          <div className="min-w-0"><b className="block truncate">公告详情与社区评论</b><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{announcement.title} · {new Date(announcement.createdAt).toLocaleString("zh-CN")} · {announcement.author}</p></div>
          <button type="button" onClick={onClose} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">关闭</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <article className="rounded-lg border border-[var(--line)] bg-white p-4"><div className="mb-3 flex items-center gap-2"><h2 className="text-base font-bold">{announcement.title}</h2>{announcement.pinned && <Pin size={14} className="text-[var(--rose)]" />}</div><MarkdownView content={announcement.content} /></article>
          <section className="mt-5">
            <h3 className="mb-3 text-sm font-semibold">社区评论 · {items.length} 条</h3>
            {loading && <p className="py-8 text-center text-sm text-[var(--muted)]">加载中…</p>}
            {!loading && !items.length && <p className="py-8 text-center text-sm text-[var(--muted)]">暂无评论</p>}
            <div className="space-y-2">{!loading && items.filter((item) => !item.parentId).map((item) => renderComment(item))}</div>
            <div className="mt-3 flex gap-2"><textarea value={replyTarget === "root" ? replyDraft : ""} onChange={(event) => { setReplyTarget("root"); setReplyDraft(event.target.value); }} maxLength={2000} rows={2} placeholder="以管理员身份回复公告…" className="field min-h-16 flex-1 resize-y p-2 text-xs" /><button type="button" onClick={() => void submitReply(null)} disabled={sending || replyTarget !== "root" || !replyDraft.trim()} className="flex h-9 items-center gap-1.5 self-end rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50"><Send size={13} />发布</button></div>
          </section>
        </div>
      </div>
    </div>
  );
}
