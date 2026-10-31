"use client";
import { isCommentSubmitKey } from "@/lib/comment-submit-key";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { MessageSquareReply, MoreHorizontal, Pin, ThumbsDown, ThumbsUp } from "lucide-react";
import type { DiscussionComment } from "@/lib/comment-store";
import type { CommentPreferences } from "@/lib/comment-preferences";
import { UserAvatar } from "./user-avatar";
import "./discussion-comments.css";

type Comment = Omit<DiscussionComment, "resourceId">;
const emptyPreferences: CommentPreferences = { hiddenIds: [], blockedAuthorIds: [] };
export function DiscussionComments({ resource, resourceId }: { resource: "gallery" | "announcements"; resourceId: string }) {
  const endpoint = `/api/${resource}/${encodeURIComponent(resourceId)}/comments`;
  const [items, setItems] = useState<Comment[]>([]);
  const [viewerId, setViewerId] = useState<number | null>(null);
  const [canModerate, setCanModerate] = useState(false);
  const [preferences, setPreferences] = useState<CommentPreferences>(emptyPreferences);
  const [sort, setSort] = useState<"hot" | "new">("hot");
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [replyId, setReplyId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);
  const [highlighted, setHighlighted] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "评论读取失败");
      if (signal?.aborted) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setViewerId(typeof data.viewerId === "number" ? data.viewerId : null);
      setCanModerate(data.canModerate === true);
      setPreferences(data.preferences || emptyPreferences);
      setMessage("");
    } catch (error) { if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "评论读取失败"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [endpoint]);
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => load(controller.signal)); return () => controller.abort(); }, [load]);
  useEffect(() => {
    if (loading) return;
    const id = new URLSearchParams(window.location.search).get("comment") || "";
    if (!id) return;
    const frame = requestAnimationFrame(() => setHighlighted(id));
    return () => cancelAnimationFrame(frame);
  }, [loading]);
  useEffect(() => {
    if (!highlighted) return;
    const frame = requestAnimationFrame(() => document.getElementById(`discussion-comment-${highlighted}`)?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [highlighted, items]);
  async function request(url: string, method: string, body?: Record<string, unknown>) {
    const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "评论操作失败");
    return data;
  }
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "评论操作失败"); }
    finally { setBusy(false); }
  }
  function composeKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>, parentId: string | null) {
    if (!isCommentSubmitKey({ ...event, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) return;
    event.preventDefault();
    if (!busy && (parentId ? replyDraft : draft).trim()) submit(parentId);
  }
  function submit(parentId: string | null) {
    void act(async () => {
      const content = parentId ? replyDraft : draft;
      if (!content.trim()) return;
      const data = await request(endpoint, "POST", { content, parentId });
      setItems(current => [...current, data.item]);
      if (parentId) { setReplyId(null); setReplyDraft(""); } else setDraft("");
      setMessage("评论已发布，可在消息中查看。");
    });
  }
  function vote(item: Comment, value: "up" | "down") {
    void act(async () => {
      const data = await request(endpoint, "PATCH", { commentId: item.id, action: "vote", vote: item.myVote === value ? null : value });
      setItems(current => current.map(comment => comment.id === item.id ? data.item : comment));
    });
  }
  function setHidden(item: Comment, hidden: boolean, author = false) {
    void act(async () => setPreferences(await request("/api/comments/preferences", "PATCH", { ...(author ? { authorId: item.authorId } : { commentId: item.id }), hidden })));
  }
  function remove(item: Comment) {
    void act(async () => {
      const data = await request(`${endpoint}/${encodeURIComponent(item.id)}`, "DELETE");
      const removed = new Set(data.deletedIds || [item.id]);
      setItems(current => current.filter(comment => !removed.has(comment.id)));
      setDeleteId(null);
      if (replyId && removed.has(replyId)) { setReplyId(null); setReplyDraft(""); }
      setMessage("评论及其下所有回复已删除。");
    });
  }
  function pin(item: Comment) {
    void act(async () => { const data = await request(endpoint, "PATCH", { action: "pin", commentId: item.id, pinned: !item.pinned }); setItems(current => current.map(comment => comment.id === item.id ? data.item : comment)); });
  }
  const ids = new Set(items.map(item => item.id));
  const childrenByParent = new Map<string, Comment[]>();
  for (const item of items) if (item.parentId && ids.has(item.parentId)) {
    const children = childrenByParent.get(item.parentId) || [];
    children.push(item); childrenByParent.set(item.parentId, children);
  }
  const roots = items.filter(item => !item.parentId || !ids.has(item.parentId)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (sort === "hot" ? b.likes - a.likes : 0) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  let highlightedRoot = items.find(item => item.id === highlighted);
  for (let depth = 0; highlightedRoot?.parentId && depth < 8; depth++) highlightedRoot = items.find(item => item.id === highlightedRoot?.parentId);
  const shownRoots = roots.slice(0, Math.max(visibleCount, highlightedRoot ? roots.findIndex(item => item.id === highlightedRoot?.id) + 1 : 0));
  function renderComment(item: Comment, depth = 0): ReactNode {
    const blockedAuthor = preferences.blockedAuthorIds.includes(item.authorId);
    const hidden = preferences.hiddenIds.includes(item.id) || blockedAuthor;
    const children = childrenByParent.get(item.id) || [];
    return <article id={`discussion-comment-${item.id}`} key={item.id} className={`discussion-comment${depth ? " is-reply" : ""}${highlighted === item.id ? " is-highlighted" : ""}`}>
      <UserAvatar userId={item.authorId} name={item.authorName} size={depth ? 28 : 40} />
      <div className="discussion-comment-content">
        <header><b>{item.authorName}</b>{item.authorId === viewerId && <span>我</span>}{item.pinned && <span className="discussion-pinned"><Pin size={12} />置顶</span>}<time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("zh-CN")}</time></header>
        {hidden && !showBlocked ? <div className="discussion-hidden">已屏蔽{blockedAuthor ? "此用户的评论" : "此评论"}。<button type="button" onClick={() => setHidden(item, false, blockedAuthor)} disabled={busy}>恢复显示</button></div> : <>
          <p>{item.content}</p>
          <div className="discussion-actions">
            <button type="button" aria-label="点赞评论" aria-pressed={item.myVote === "up"} disabled={!viewerId || busy} onClick={() => vote(item, "up")}><ThumbsUp size={15} />{item.likes || "点赞"}</button>
            <button type="button" aria-label="点踩评论" aria-pressed={item.myVote === "down"} disabled={!viewerId || busy} onClick={() => vote(item, "down")}><ThumbsDown size={15} />{item.dislikes || "点踩"}</button>
            <button type="button" disabled={!viewerId || busy} onClick={() => { setReplyId(current => current === item.id ? null : item.id); setReplyDraft(""); }}><MessageSquareReply size={15} />回复{children.length ? ` ${children.length}` : ""}</button>
            {viewerId && <details className="discussion-menu"><summary aria-label="评论操作"><MoreHorizontal size={18} /></summary><div role="menu" onClick={event => { const details = event.currentTarget.closest("details"); if (details) details.open = false; }}>
              {item.authorId !== viewerId && <><button type="button" role="menuitem" disabled={busy} onClick={() => setHidden(item, !preferences.hiddenIds.includes(item.id))}>{preferences.hiddenIds.includes(item.id) ? "取消屏蔽评论" : "屏蔽此评论"}</button><button type="button" role="menuitem" disabled={busy} onClick={() => setHidden(item, !blockedAuthor, true)}>{blockedAuthor ? "取消屏蔽用户" : "屏蔽此用户"}</button></>}
              {canModerate && <button type="button" role="menuitem" disabled={busy} onClick={() => pin(item)}>{item.pinned ? "取消置顶" : "置顶评论"}</button>}
              {(item.authorId === viewerId || canModerate) && <button type="button" role="menuitem" disabled={busy} onClick={() => setDeleteId(item.id)}>{item.authorId === viewerId ? "删除我的评论" : "删除评论"}</button>}
            </div></details>}
          </div>
          {deleteId === item.id && <div className="discussion-confirm" role="alertdialog" aria-label="删除评论确认"><p>删除这条评论及其下所有回复？</p><button type="button" onClick={() => setDeleteId(null)} disabled={busy}>取消</button><button type="button" onClick={() => remove(item)} disabled={busy}>确认删除</button></div>}
          {replyId === item.id && <div className="discussion-compose"><textarea aria-label={`回复 ${item.authorName}`} autoFocus rows={2} maxLength={2000} value={replyDraft} onKeyDown={event => composeKeyDown(event, item.id)} onChange={event => setReplyDraft(event.target.value)} placeholder={`回复 @${item.authorName}`} /><button type="button" disabled={busy || !replyDraft.trim()} onClick={() => submit(item.id)}>回复</button></div>}
        </>}
        {children.length > 0 && depth < 8 && <div className="discussion-replies">{children.map(child => renderComment(child, depth + 1))}</div>}
      </div>
    </article>;
  }
  return <section className="discussion-comments" id="comments" aria-label="评论区">
    <header className="discussion-heading"><h2>评论 <small>{items.length}</small></h2><div role="tablist" aria-label="评论排序"><button type="button" role="tab" aria-selected={sort === "hot"} onClick={() => setSort("hot")}>最热</button><button type="button" role="tab" aria-selected={sort === "new"} onClick={() => setSort("new")}>最新</button></div><button type="button" disabled={busy || loading} onClick={() => void load()}>刷新</button></header>
    {viewerId ? <div className="discussion-compose"><UserAvatar userId={viewerId} name="我" /><textarea aria-label="发表评论" rows={3} maxLength={2000} value={draft} onKeyDown={event => composeKeyDown(event, null)} onChange={event => setDraft(event.target.value)} placeholder="Enter 发布，Shift+Enter 换行" /><button type="button" disabled={busy || !draft.trim()} onClick={() => submit(null)}>{busy ? "处理中…" : "发布"}</button><small>{Array.from(draft).length} / 2000</small></div> : !loading && <p className="discussion-login"><Link href="/sign-in">登录</Link> 后参与评论</p>}
    {message && <p role="status" className="discussion-message">{message}</p>}
    {(preferences.hiddenIds.length > 0 || preferences.blockedAuthorIds.length > 0) && <button type="button" className="discussion-blocked-toggle" onClick={() => setShowBlocked(value => !value)}>{showBlocked ? "隐藏已屏蔽内容" : "查看已屏蔽内容"}</button>}
    {loading ? <p role="status" className="discussion-empty">正在读取评论…</p> : !roots.length ? <p className="discussion-empty">还没有评论，来聊聊你的想法吧</p> : <div className="discussion-list">{shownRoots.map(item => renderComment(item))}{shownRoots.length < roots.length && <button type="button" className="lfn-button" onClick={() => setVisibleCount(value => value + 20)}>加载更多评论（还剩 {roots.length - shownRoots.length} 条）</button>}</div>}
  </section>;
}
