"use client";

import { WorkspaceNav } from "@/app/workspace-nav";
import { ArrowLeft, Download, Image as ImageIcon } from "lucide-react";
import Image from "@/app/cached-image";
import Link from "next/link";
import { useState } from "react";
import { fetchCachedImageBlob } from "@/lib/browser-image-cache";
import { downloadLocalTiledUpscaleResult } from "@/lib/local-tiled-upscale-result";
import { ImageDownloadMenu } from "@/app/image-download-menu";
import { useHistoryDetail } from "../use-history-detail";

const promptKeys = new Set(["prompt", "negative_prompt"]);

export default function HistoryDetailPage({ params, ownerId }: { params: Promise<{ id: string }>; ownerId: number }) {
  const { item, message } = useHistoryDetail(params, ownerId);
  const [downloadError, setDownloadError] = useState("");

  async function downloadArchive() {
    if (!item?.archive) return;
    setDownloadError("");
    try {
      if (!await downloadLocalTiledUpscaleResult(item.archive.id, `lfn-${item.id}.png`)) throw new Error("浏览器中找不到原尺寸文件");
    } catch (error) { setDownloadError(error instanceof Error ? error.message : "下载失败"); }
  }

  const parameters = item?.parameters || {};
  const prompt = String(parameters.prompt || "");
  const negativePrompt = String(parameters.negative_prompt || "");
  const otherParameters = Object.entries(parameters).filter(([key]) => !promptKeys.has(key));

  return (
    <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <Link replace href="/history" className="flex items-center gap-2 text-sm font-semibold"><ArrowLeft size={16} />图片历史</Link>
        <Link href="/image" className="text-sm font-semibold text-[var(--rose)]">返回工作台</Link>
      </header>
      <WorkspaceNav />
      <section className="mx-auto max-w-7xl p-4 sm:p-7">
        {message ? <p className="py-20 text-center text-sm text-[var(--muted)]">{message}</p> : !item ? <p className="py-20 text-center text-sm text-[var(--muted)]">正在读取历史图片…</p> : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <div className="relative flex min-h-[55vh] items-center justify-center overflow-hidden rounded-md border border-[var(--line)] bg-[#ebe9e2] p-3 lg:sticky lg:top-4 lg:h-[calc(100dvh-32px)]">
              <Image src={item.imageUrl} ownerId={ownerId} alt="历史生成图片" fill unoptimized className="object-contain" />
              {item.archive ? <button type="button" className="absolute right-3 top-3 inline-flex min-h-11 items-center gap-2 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm" onClick={() => void downloadArchive()}><Download size={16} />下载原尺寸图片</button>
                : <ImageDownloadMenu getImage={() => fetchCachedImageBlob(item.imageUrl, ownerId)} filename={`lfn-${item.id}`} className="absolute right-3 top-3 history-detail-download" title="选择图片下载方式" />}
            </div>
            <aside className="min-w-0 space-y-4">
              <header className="flex items-center justify-between gap-3">
                <div><p className="text-xs font-semibold text-[var(--rose)]">图片历史 / 生成记录</p><h1 className="mt-1 font-[var(--font-display)] text-xl font-semibold">生成参数</h1></div>
                <time className="shrink-0 text-xs text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
              </header>
              {item.archive && <p className="text-sm text-[var(--muted)]">原图 {item.archive.width} × {item.archive.height}，已保存在本机</p>}
              {downloadError && <p role="alert" className="text-sm text-[var(--rose)]">{downloadError}</p>}
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
