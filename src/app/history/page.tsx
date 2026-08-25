"use client";

import { ArrowLeft, Download, History, RotateCcw, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";

type HistoryItem = {
  id: string;
  createdAt: string;
  imageUrl: string;
  parameters: Record<string, string | number>;
};

function reuseHref(item: HistoryItem) {
  const params = new URLSearchParams({ reuse: "1" });
  for (const [key, value] of Object.entries(item.parameters))
    params.set(key, String(value));
  return `/image?${params}`;
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/history", { cache: "no-store", signal: controller.signal })
      .then((response) =>
        readJson<{ items?: HistoryItem[] }>(response, "读取历史失败"),
      )
      .then((result) => setItems(result.items || []))
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (error instanceof SessionExpiredError) setExpired(error.message);
        else setMessage(error instanceof Error ? error.message : "读取历史失败");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function remove(id: string) {
    if (!window.confirm("确认删除这张历史图片？删除后无法恢复。")) return;
    const response = await fetch(`/api/history?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const result = await response.json();
      setMessage(result.message || "删除失败");
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <History size={20} className="text-[var(--rose)]" />
          <b>图片历史</b>
          <span className="text-xs text-[var(--muted)]">最近 10 张</span>
        </div>
        <Link
          href="/image"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ArrowLeft size={16} /> 返回工作台
        </Link>
      </header>
      <section className="mx-auto max-w-7xl p-4 sm:p-7">
        {expired && <SessionExpiredNotice message={expired} />}
        {message && (
          <div className="mb-4 rounded border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
            {message}
          </div>
        )}
        {loading ? (
          <p className="py-20 text-center text-sm text-[var(--muted)]">
            正在读取历史…
          </p>
        ) : items.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <article
                key={item.id}
                className="overflow-hidden rounded-md border border-[var(--line)] bg-white"
              >
                <div className="relative aspect-[4/5] bg-[#ebe9e2]">
                  <Image
                    src={item.imageUrl}
                    alt="历史生成图片"
                    fill
                    unoptimized
                    className="object-contain"
                  />
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 min-h-10 text-xs leading-5">
                    {item.parameters.prompt || "未记录提示词"}
                  </p>
                  <div className="mt-2 flex justify-between text-[10px] text-[var(--muted)]">
                    <span>{item.parameters.model || "未知模型"}</span>
                    <time>
                      {new Date(item.createdAt).toLocaleString("zh-CN")}
                    </time>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Link
                      href={reuseHref(item)}
                      className="history-action"
                      title="复用参数"
                    >
                      <RotateCcw size={15} />
                    </Link>
                    <a
                      href={item.imageUrl}
                      download={`lfn-${item.id}.png`}
                      className="history-action"
                      title="下载图片"
                    >
                      <Download size={15} />
                    </a>
                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      className="history-action text-[var(--rose)]"
                      title="删除历史"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="py-24 text-center">
            <History size={34} className="mx-auto text-[var(--muted)]" />
            <h1 className="mt-4 text-xl font-semibold">还没有生成历史</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              生成成功的图片会自动保留在这里。
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
