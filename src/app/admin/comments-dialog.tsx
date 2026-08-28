"use client";

import { useCallback, useEffect, useState } from "react";
import type { AnnouncementItem } from "@/app/announcement-dialog";

type AdminComment = {
  id: string;
  announcementId: string;
  authorName: string;
  content: string;
  createdAt: string;
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

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function remove(commentId: string) {
    try {
      const response = await fetch(`/api/announcements/${announcement.id}/comments/${commentId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "删除失败");
      setItems((current) => current.filter((item) => item.id !== commentId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    }
  }

  return (
    <div className="fixed inset-0 z-[30000] grid place-items-center bg-[#202328]/45 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[#fffefa] shadow-[0_24px_80px_rgba(50,45,40,.25)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[#f5f3ed] px-5 py-4">
          <div className="min-w-0"><b className="block truncate">社区评论</b><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{announcement.title}</p></div>
          <button type="button" onClick={onClose} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">关闭</button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
          {loading && <p className="py-8 text-center text-sm text-[var(--muted)]">加载中…</p>}
          {!loading && !items.length && <p className="py-8 text-center text-sm text-[var(--muted)]">暂无评论</p>}
          {!loading && items.map((item) => (
            <div key={item.id} className="rounded border border-[var(--line)] bg-[#faf9f5] p-3">
              <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold">{item.authorName}</span><time className="text-[10px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</time></div>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5">{item.content}</p>
              <button type="button" onClick={() => remove(item.id)} className="mt-2 text-[10px] font-semibold text-red-600 hover:underline">删除评论</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
