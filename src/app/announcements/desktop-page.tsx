"use client";

import { WorkspaceNav } from "@/app/workspace-nav";

import { Eye, EyeOff, LoaderCircle, MessageSquareReply, MoreHorizontal, Pin, RotateCcw, Send, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownView } from "@/app/markdown";
import type { AnnouncementItem } from "@/app/announcement-dialog";
import { PublicHeader } from "@/app/public-header";

type Comment = {
  id: string;
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
type LoadState = "loading" | "loaded" | "error";

function AnnouncementCommentThread({
  comment, comments, authenticated, replyTarget, drafts, submittingId,
  onReply, onDraft, onSubmit, onVote, onDelete, onHide, onRestore, viewerId, hiddenIds, openMenuId, onToggleMenu, highlightedId, depth = 0,
}: {
  comment: Comment;
  comments: Comment[];
  authenticated: boolean;
  replyTarget: string | null;
  drafts: Record<string, string>;
  submittingId: string | null;
  onReply: (id: string) => void;
  onDraft: (id: string, value: string) => void;
  onSubmit: (parentId: string) => void;
  onVote: (id: string, vote: "up" | "down" | null) => void;
  onDelete: (id: string) => void;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
  viewerId: number | null;
  hiddenIds: Set<string>;
  openMenuId: string | null;
  onToggleMenu: (id: string) => void;
  highlightedId: string;
  depth?: number;
}) {
  const children = comments.filter((item) => item.parentId === comment.id);
  const replyDraft = drafts[comment.id] || "";
  const hidden = hiddenIds.has(comment.id);
  const ownsComment = viewerId !== null && viewerId === comment.authorId;
  return <div id={`announcement-comment-${comment.id}`} className={`scroll-mt-24 rounded border bg-[#faf9f5] px-3 py-2.5 ${highlightedId === comment.id ? "border-[var(--rose)] ring-2 ring-[var(--rose)]/25" : comment.pinned ? "border-[var(--rose)]" : "border-[var(--line)]"}`}>
    <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--muted)]"><span className="flex items-center gap-1.5"><b className="text-[var(--ink)]">{comment.authorName}</b>{comment.pinned && <span className="inline-flex items-center gap-1 text-[var(--rose)]"><Pin size={10} />置顶</span>}</span><time>{new Date(comment.createdAt).toLocaleString("zh-CN")}</time></div>
    {hidden ? <p className="mt-2 flex items-center gap-2 text-xs text-[var(--muted)]">你已隐藏这条评论。<button type="button" onClick={() => onRestore(comment.id)} className="inline-flex items-center gap-1 text-[var(--rose)] hover:underline"><Eye size={12} />恢复显示</button></p> : <>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5">{comment.content}</p>
      <div className="mt-2 flex items-center gap-3 text-[10px]">
        <button type="button" disabled={!authenticated} onClick={() => onVote(comment.id, comment.myVote === "up" ? null : "up")} className={`inline-flex items-center gap-1 disabled:opacity-40 ${comment.myVote === "up" ? "text-[var(--rose)]" : "text-[var(--muted)]"}`}><ThumbsUp size={12} />{comment.likes}</button>
        <button type="button" disabled={!authenticated} onClick={() => onVote(comment.id, comment.myVote === "down" ? null : "down")} className={`inline-flex items-center gap-1 disabled:opacity-40 ${comment.myVote === "down" ? "text-[var(--rose)]" : "text-[var(--muted)]"}`}><ThumbsDown size={12} />{comment.dislikes}</button>
        {authenticated && <button type="button" onClick={() => onReply(comment.id)} className="inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--rose)]"><MessageSquareReply size={12} />回复</button>}
        <div className="relative ml-auto">
          <button type="button" aria-label="评论操作" aria-haspopup="menu" aria-expanded={openMenuId === comment.id} onClick={() => onToggleMenu(comment.id)} className="grid h-6 w-6 place-items-center rounded hover:bg-[#eeeae1] hover:text-[var(--ink)]"><MoreHorizontal size={15} /></button>
          {openMenuId === comment.id && <div role="menu" className="absolute bottom-7 right-0 z-20 min-w-32 rounded border border-[var(--line)] bg-white p-1 shadow-lg">{ownsComment ? <button type="button" role="menuitem" onClick={() => onDelete(comment.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-red-700 hover:bg-red-50"><Trash2 size={13} />删除我的评论</button> : <button type="button" role="menuitem" onClick={() => onHide(comment.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[#f5f3ed]"><EyeOff size={13} />不显示此评论</button>}</div>}
        </div>
      </div>
      {replyTarget === comment.id && <div className="mt-2 flex gap-2"><textarea autoFocus value={replyDraft} onChange={(event) => onDraft(comment.id, event.target.value)} maxLength={2000} rows={2} placeholder={`回复 ${comment.authorName}…`} className="field min-h-14 flex-1 resize-y p-2 text-xs" /><button type="button" onClick={() => onSubmit(comment.id)} disabled={submittingId === comment.id || !replyDraft.trim()} className="flex h-8 shrink-0 items-center gap-1 self-end rounded bg-[var(--rose)] px-2.5 text-xs font-semibold text-white disabled:opacity-50"><Send size={12} />发送</button></div>}
    </>}
    {children.length > 0 && depth < 8 && <div className="mt-2 space-y-2 border-l border-[var(--line)] pl-3">{children.map((child) => <AnnouncementCommentThread key={child.id} comment={child} comments={comments} authenticated={authenticated} replyTarget={replyTarget} drafts={drafts} submittingId={submittingId} onReply={onReply} onDraft={onDraft} onSubmit={onSubmit} onVote={onVote} onDelete={onDelete} onHide={onHide} onRestore={onRestore} viewerId={viewerId} hiddenIds={hiddenIds} openMenuId={openMenuId} onToggleMenu={onToggleMenu} highlightedId={highlightedId} depth={depth + 1} />)}</div>}
  </div>;
}

export default function AnnouncementsPage() {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentLoading, setCommentLoading] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [viewerId, setViewerId] = useState<number | null>(null);
  const [hiddenCommentIds, setHiddenCommentIds] = useState<Set<string>>(new Set());
  const [openCommentMenuId, setOpenCommentMenuId] = useState<string | null>(null);
  const commentRequestIds = useRef<Record<string, number>>({});

  const loadAnnouncements = useCallback(async () => {
    setLoadState("loading");
    setError("");
    try {
      const response = await fetch("/api/announcements");
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
      .then((result) => {
        setAuthenticated(Boolean(result.authenticated));
        const id = Number(result.user?.id);
        setViewerId(Number.isSafeInteger(id) && id > 0 ? id : null);
      })
      .catch(() => { setAuthenticated(false); setViewerId(null); });
  }, [loadAnnouncements]);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("lfn-hidden-announcement-comments-v1") || "[]");
      if (Array.isArray(stored)) {
        const hidden = new Set(stored.filter((id): id is string => typeof id === "string").slice(-2000));
        window.queueMicrotask(() => setHiddenCommentIds(hidden));
      }
    } catch { /* 忽略不可用或损坏的浏览器缓存。 */ }
  }, []);

  function setCommentHidden(id: string, hidden: boolean) {
    const next = new Set(hiddenCommentIds);
    if (hidden) next.add(id); else next.delete(id);
    try { window.localStorage.setItem("lfn-hidden-announcement-comments-v1", JSON.stringify([...next].slice(-2000))); } catch { /* 隐藏状态只保存在本地。 */ }
    setHiddenCommentIds(next);
    setOpenCommentMenuId(null);
  }

  const loadComments = useCallback(async (id: string, refresh = false) => {
    const requestId = (commentRequestIds.current[id] || 0) + 1;
    commentRequestIds.current[id] = requestId;
    try {
      const response = await fetch(`/api/announcements/${id}/comments`, { cache: refresh ? "reload" : "default" });
      const result = await response.json();
      if (response.ok && commentRequestIds.current[id] === requestId)
        setComments((current) => ({ ...current, [id]: result.items || [] }));
    } catch {
      // 评论读取失败不影响公告正文。
    }
  }, []);

  useEffect(() => {
    if (items[0] && !new URLSearchParams(window.location.search).has("comment"))
      void Promise.resolve().then(() => loadComments(items[0].id));
  }, [items, loadComments]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const announcementId = params.get("announcement") || "";
    const commentId = params.get("comment") || "";
    if (!announcementId || !commentId) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setExpanded(announcementId);
      setHighlightedCommentId(commentId);
      return loadComments(announcementId, true);
    }).finally(() => {
      window.setTimeout(() => {
        if (active) document.getElementById(`announcement-comment-${commentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 250);
    });
    return () => { active = false; };
  }, [loadComments]);

  function toggle(id: string, open: boolean) {
    setExpanded(open ? "" : id);
    if (!open && !comments[id]) void loadComments(id);
  }

  async function submitComment(id: string, parentId: string | null = null) {
    const draftKey = parentId || `root:${id}`;
    const content = commentDrafts[draftKey]?.trim() || "";
    if (!content) return;
    setCommentLoading(draftKey);
    setMessage("");
    try {
      const response = await fetch(`/api/announcements/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, ...(parentId ? { parentId } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "评论发布失败");
        return;
      }
      // 使在途 GET 失效，避免旧响应把刚发布的评论覆盖掉。
      commentRequestIds.current[id] = (commentRequestIds.current[id] || 0) + 1;
      setComments((current) => ({ ...current, [id]: [...(current[id] || []), result.item] }));
      setCommentDrafts((current) => ({ ...current, [draftKey]: "" }));
      setReplyTarget(null);
    } catch {
      setMessage("评论发布失败，请稍后重试");
    } finally {
      setCommentLoading(null);
    }
  }

  async function deleteComment(announcementId: string, commentId: string) {
    const target = comments[announcementId]?.find((item) => item.id === commentId);
    if (!target || target.authorId !== viewerId || !window.confirm("确定删除自己的这条评论吗？对应的回复通知也会一并删除。")) return;
    setCommentLoading(commentId);
    setMessage("");
    try {
      const response = await fetch(`/api/announcements/${announcementId}/comments/${commentId}`, { method: "DELETE", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "删除评论失败");
      commentRequestIds.current[announcementId] = (commentRequestIds.current[announcementId] || 0) + 1;
      setComments((current) => ({ ...current, [announcementId]: Array.isArray(result.items) ? result.items : (current[announcementId] || []).filter((item) => !result.deletedIds?.includes(item.id)) }));
      setCommentHidden(commentId, false);
      setOpenCommentMenuId(null);
      void loadComments(announcementId, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除评论失败");
    } finally {
      setCommentLoading(null);
    }
  }

  const latest = items[0];

  return (
    <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader current="announcements" />
      <WorkspaceNav />
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
                            {itemComments.filter((comment) => !comment.parentId).map((comment) => <AnnouncementCommentThread
                              key={comment.id} comment={comment} comments={itemComments} authenticated={authenticated} replyTarget={replyTarget}
                              drafts={commentDrafts} submittingId={commentLoading} viewerId={viewerId} hiddenIds={hiddenCommentIds}
                              openMenuId={openCommentMenuId} onToggleMenu={(id) => setOpenCommentMenuId((current) => current === id ? null : id)}
                              onReply={setReplyTarget} onDraft={(id, value) => setCommentDrafts((current) => ({ ...current, [id]: value }))}
                              onSubmit={(parentId) => void submitComment(item.id, parentId)}
                              onDelete={(commentId) => void deleteComment(item.id, commentId)}
                              onHide={(commentId) => setCommentHidden(commentId, true)} onRestore={(commentId) => setCommentHidden(commentId, false)}
                              onVote={(commentId, vote) => { void fetch(`/api/announcements/${item.id}/comments`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "vote", commentId, vote }) }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.message || "投票失败"); setComments((current) => ({ ...current, [item.id]: (current[item.id] || []).map((entry) => entry.id === commentId ? result.item : entry) })); }).catch((error) => setMessage(error instanceof Error ? error.message : "投票失败")); }}
                              highlightedId={highlightedCommentId}
                            />)}
                            {!itemComments.length && <p className="text-xs text-[var(--muted)]">还没有反馈，欢迎留下第一条建议。</p>}
                          </div>
                          {authenticated && (
                            <div className="mt-3 flex gap-2">
                              <textarea value={commentDrafts[`root:${item.id}`] || ""} onChange={(event) => setCommentDrafts((current) => ({ ...current, [`root:${item.id}`]: event.target.value }))} maxLength={2000} rows={2} placeholder="写下你的 UI 或功能建议…" className="field min-h-16 flex-1 resize-y p-2 text-xs" />
                              <button type="button" onClick={() => void submitComment(item.id)} disabled={commentLoading === `root:${item.id}` || !(commentDrafts[`root:${item.id}`] || "").trim()} className="flex h-9 shrink-0 items-center gap-1.5 self-end rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                                {commentLoading === `root:${item.id}` ? <LoaderCircle size={13} className="animate-spin" /> : <Send size={13} />}发布
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
