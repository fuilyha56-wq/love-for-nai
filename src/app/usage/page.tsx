"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type LogItem = Record<string, unknown>;

export default function UsagePage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/usage?page=${page}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "读取使用记录失败");
        setItems(result.items || []);
        setTotal(result.total || 0);
        setMessage("");
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setMessage(error instanceof Error ? error.message : "读取使用记录失败");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [page]);

  return (
    <ProductPage title="使用记录" icon={<ListFilter size={20} />}>
      {message && <Notice>{message}</Notice>}
      <div className="overflow-hidden rounded-md border border-[var(--line)] bg-white">
        <div className="grid grid-cols-[minmax(140px,1fr)_100px_90px_150px] gap-3 border-b border-[var(--line)] bg-[#f2f0ea] px-4 py-3 text-xs font-semibold">
          <span>模型 / 请求</span>
          <span>消耗</span>
          <span>状态</span>
          <span>时间</span>
        </div>
        {loading ? (
          <Empty text="正在读取使用记录…" />
        ) : items.length ? (
          items.map((item, index) => (
            <div
              key={String(item.id || index)}
              className="grid grid-cols-[minmax(140px,1fr)_100px_90px_150px] gap-3 border-b border-[var(--line)] px-4 py-3 text-xs last:border-0"
            >
              <div className="min-w-0">
                <b className="block truncate">
                  {String(
                    item.model_name || item.model || item.name || "未知模型",
                  )}
                </b>
                <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">
                  {String(
                    item.request_id || item.token_name || item.type || "-",
                  )}
                </span>
              </div>
              <span>
                {String(item.quota || item.cost || item.amount || "-")}
              </span>
              <span>{String(item.status || item.type_name || "已记录")}</span>
              <span>
                {formatTime(
                  item.created_at || item.createdAt || item.timestamp,
                )}
              </span>
            </div>
          ))
        ) : (
          <Empty text="暂无使用记录" />
        )}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-[var(--muted)]">
          共 {total} 条 · 第 {page} 页
        </span>
        <div className="flex gap-2">
          <button
            className="page-button"
            disabled={page <= 1}
            onClick={() => {
              setLoading(true);
              setPage((value) => value - 1);
            }}
          >
            <ChevronLeft size={15} />
            上一页
          </button>
          <button
            className="page-button"
            disabled={items.length < 20}
            onClick={() => {
              setLoading(true);
              setPage((value) => value + 1);
            }}
          >
            下一页
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </ProductPage>
  );
}

function formatTime(value: unknown) {
  if (!value) return "-";
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("zh-CN");
}

function ProductPage({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex items-center gap-3 text-[var(--rose)]">
          {icon}
          <b className="text-[var(--ink)]">{title}</b>
        </div>
        <Link
          href="/image"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ArrowLeft size={16} />
          返回工作台
        </Link>
      </header>
      <section className="mx-auto max-w-6xl p-4 sm:p-8">{children}</section>
    </main>
  );
}
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="px-4 py-16 text-center text-sm text-[var(--muted)]">{text}</p>
  );
}
