"use client";

import { ArrowLeft, ImageIcon, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";

type ModelItem = { id: string; kind: string };
export default function ModelsPage() {
  const [items, setItems] = useState<ModelItem[]>([]);
  const [expired, setExpired] = useState("");
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      const result = await readJson<{ items?: ModelItem[] }>(
        response,
        "读取模型失败",
      );
      setItems(result.items || []);
      setLoadState("loaded");
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      const nextError = error instanceof Error ? error.message : "读取模型失败";
      setLoadError(nextError);
      setLoadState("error");
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
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
        {expired && <SessionExpiredNotice message={expired} />}
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
        {!items.length && loadState === "loading" && (
          <p className="py-20 text-center text-sm text-[var(--muted)]">
            正在读取当前分组可用模型…
          </p>
        )}
        {!items.length && loadState === "error" && (
          <div className="my-5 rounded border border-[#e4c991] bg-[#fff8e8] p-4 text-center text-sm text-[#77531e]">
            <p>{loadError || "读取模型失败"}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 h-8 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white"
            >
              重试
            </button>
          </div>
        )}
        {!items.length && loadState === "loaded" && !expired && (
          <p className="py-20 text-center text-sm text-[var(--muted)]">
            当前分组暂无可用模型。
          </p>
        )}
      </section>
    </main>
  );
}
