"use client";

import { ArrowLeft, ImageIcon, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type ModelItem = { id: string; kind: string };
export default function ModelsPage() {
  const [items, setItems] = useState<ModelItem[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/models", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "读取模型失败");
        setItems(result.items || []);
      })
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "读取模型失败"),
      );
  }, []);
  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <Sparkles size={20} className="text-[var(--rose)]" />
          <b>可用模型</b>
        </div>
        <Link
          href="/image"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ArrowLeft size={16} />
          返回工作台
        </Link>
      </header>
      <section className="mx-auto max-w-6xl p-4 sm:p-8">
        {message && (
          <div className="mb-4 rounded border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
            {message}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="flex items-center gap-3 rounded-md border border-[var(--line)] bg-white p-4"
            >
              {item.kind === "图像模型" ? (
                <ImageIcon size={19} className="text-[var(--rose)]" />
              ) : (
                <Sparkles size={19} className="text-emerald-700" />
              )}
              <div className="min-w-0">
                <b className="block truncate text-sm">{item.id}</b>
                <span className="text-[11px] text-[var(--muted)]">
                  {item.kind}
                </span>
              </div>
            </article>
          ))}
        </div>
        {!items.length && !message && (
          <p className="py-20 text-center text-sm text-[var(--muted)]">
            正在读取当前分组可用模型…
          </p>
        )}
      </section>
    </main>
  );
}
