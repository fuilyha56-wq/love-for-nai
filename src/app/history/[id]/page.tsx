"use client";

import { WorkspaceNav } from "@/app/workspace-nav";
import { ArrowLeft, Download, Image as ImageIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type HistoryItem = {
  id: string;
  createdAt: string;
  imageUrl: string;
  parameters: Record<string, string | number | boolean>;
};

const promptKeys = new Set(["prompt", "negative_prompt"]);

export default function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [item, setItem] = useState<HistoryItem | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { id } = await params;
        const response = await fetch(`/api/history/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as HistoryItem & { message?: string };
        if (!response.ok) throw new Error(result.message || "读取历史失败");
        setItem(result);
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "读取历史失败");
      }
    })();
    return () => controller.abort();
  }, [params]);

  const parameters = item?.parameters || {};
  const prompt = String(parameters.prompt || "");
  const negativePrompt = String(parameters.negative_prompt || "");
  const otherParameters = Object.entries(parameters).filter(([key]) => !promptKeys.has(key));

  return (
    <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <Link href="/history" className="flex items-center gap-2 text-sm font-semibold"><ArrowLeft size={16} />图片历史</Link>
        <Link href="/image" className="text-sm font-semibold text-[var(--rose)]">返回工作台</Link>
      </header>
      <WorkspaceNav />
      <section className="mx-auto max-w-7xl p-4 sm:p-7">
        {message ? <p className="py-20 text-center text-sm text-[var(--muted)]">{message}</p> : !item ? <p className="py-20 text-center text-sm text-[var(--muted)]">正在读取历史图片…</p> : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <div className="relative flex min-h-[55vh] items-center justify-center overflow-hidden rounded-md border border-[var(--line)] bg-[#ebe9e2] p-3 lg:sticky lg:top-4 lg:h-[calc(100dvh-32px)]">
              <Image src={item.imageUrl} alt="历史生成图片" fill unoptimized className="object-contain" />
              <a href={item.imageUrl} download={`lfn-${item.id}.png`} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-[#202328]/75 text-white" aria-label="下载原图" title="下载原图"><Download size={16} /></a>
            </div>
            <aside className="min-w-0 space-y-4">
              <header className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-semibold text-[var(--rose)]">图片历史 / 生成记录</p><h1 className="mt-1 font-[var(--font-display)] text-xl font-semibold">生成参数</h1></div>
                <time className="shrink-0 text-xs text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
              </header>
              {(prompt || negativePrompt) && <section className="space-y-3">
                {prompt && <PromptBlock title="正面提示词" value={prompt} />}
                {negativePrompt && <PromptBlock title="负面提示词" value={negativePrompt} />}
              </section>}
              <section className="overflow-hidden rounded-md border border-[var(--line)] bg-white">
                <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2.5 text-sm font-semibold"><ImageIcon size={15} className="text-[var(--rose)]" />生成设置</div>
                <dl className="grid grid-cols-2 gap-px bg-[var(--line)] sm:grid-cols-3">
                  {otherParameters.map(([key, value]) => <div key={key} className="min-w-0 bg-white px-3 py-2"><dt className="text-[10px] text-[var(--muted)]">{key}</dt><dd className="mt-0.5 break-words text-xs">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}
                </dl>
              </section>
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}

function PromptBlock({ title, value }: { title: string; value: string }) {
  const [expanded, setExpanded] = useState(false);
  return <section className="overflow-hidden rounded-md border border-[var(--line)] bg-white">
    <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2"><h2 className="text-xs font-semibold">{title}</h2><button type="button" className="text-[11px] text-[var(--rose)]" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? "收起" : "展开"}</button></div>
    <p className={`px-3 py-2.5 text-xs leading-5 text-[var(--muted)] [overflow-wrap:anywhere] ${expanded ? "max-h-[45vh] overflow-y-auto whitespace-pre-wrap" : "line-clamp-5"}`}>{value}</p>
  </section>;
}