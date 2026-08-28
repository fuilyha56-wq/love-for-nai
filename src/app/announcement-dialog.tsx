"use client";

import { Megaphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { MarkdownView } from "@/app/markdown";

export type AnnouncementItem = {
  id: string;
  title: string;
  content: string;
  level: "info" | "warning";
  createdAt: string;
  updatedAt?: string;
  author: string;
  pinned: boolean;
};

const READ_KEY = "lfn-announcements-read";

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

// 弹窗公告：展示未读公告（置顶优先），带「我知道了」确认按钮，
// 已读 id 记在 localStorage。
export function AnnouncementDialog({
  items,
  onOpenList,
}: {
  items: AnnouncementItem[];
  onOpenList?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [seen, setSeen] = useState<string[]>([]);

  useEffect(() => {
    // localStorage 读取放进异步微任务，避免 effect 内同步 setState。
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setSeen(readSeen());
        setVisible(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const unread = items.filter((item) => !seen.includes(item.id));
  const current = unread[index] || unread[0];

  function confirm() {
    if (!current) {
      setVisible(false);
      return;
    }
    const next = [...seen, current.id];
    setSeen(next);
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(next));
    } catch {
      // 私有模式等场景忽略。
    }
    setIndex(0);
    if (unread.length <= 1) setVisible(false);
  }

  if (!visible || !current) return null;

  return (
    <div className="fixed inset-0 z-[30000] grid place-items-center bg-[#202328]/45 p-4">
      <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[#fffefa] shadow-[0_24px_80px_rgba(50,45,40,.25)]">
        <div className={`flex items-center justify-between gap-3 border-b px-5 py-4 ${current.level === "warning" ? "border-amber-200 bg-[#fff8e8]" : "border-[var(--line)] bg-[#f5f3ed]"}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Megaphone size={18} className={current.level === "warning" ? "text-[#b8860b]" : "text-[var(--rose)]"} />
            <div className="min-w-0">
              <b className="truncate">{current.title}</b>
              <p className="text-[10px] text-[var(--muted)]">
                {new Date(current.createdAt).toLocaleString("zh-CN")} · {current.author}
                {current.pinned ? " · 置顶" : ""}
                {unread.length > 1 ? ` · ${Math.min(index + 1, unread.length)}/${unread.length} 条未读` : ""}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setVisible(false)} aria-label="关闭公告" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:bg-black/5 hover:text-[var(--ink)]">
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <MarkdownView content={current.content} />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--line)] bg-[#f5f3ed] px-5 py-3.5">
          <button type="button" onClick={onOpenList} className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--rose)]">
            查看全部公告
          </button>
          <button type="button" onClick={confirm} className="flex h-9 items-center gap-2 rounded bg-[var(--rose)] px-5 text-sm font-semibold text-white hover:bg-[var(--rose-dark)]">
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
