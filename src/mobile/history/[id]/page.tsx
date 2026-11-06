"use client";

import { ImageDetailWorkspace, ImageMetadataParameters, ImagePromptSection } from "@/mobile/ui/image-detail-workspace";
import { Download, Maximize2, RotateCcw } from "lucide-react";
import Image from "@/mobile/cached-image";
import Link from "next/link";
import { useState } from "react";
import { fetchCachedImageBlob } from "@/lib/browser-image-cache";
import { downloadLocalTiledUpscaleResult } from "@/lib/local-tiled-upscale-result";
import { ImageDownloadMenu } from "@/mobile/image-download-menu";
import { useHistoryDetail } from "@/app/history/use-history-detail";

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

  return <ImageDetailWorkspace title="历史图片" backHref="/history" backLabel="图片历史" loading={!item && !message} error={message}
    image={item && <div className="launcher-detail-image"><Image src={item.imageUrl} ownerId={ownerId} alt="历史生成图片" fill unoptimized className="object-contain" />{item.archive ? <button type="button" className="absolute right-3 top-3 inline-flex min-h-11 items-center gap-2 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm" onClick={() => void downloadArchive()}><Download size={16} />下载原尺寸图片</button> : <ImageDownloadMenu getImage={() => fetchCachedImageBlob(item.imageUrl, ownerId)} filename={`lfn-${item.id}`} className="absolute right-3 top-3 history-detail-download" title="选择图片下载方式" />}</div>}
    metadata={item && <aside><header><h2 className="text-lg font-semibold">生成参数</h2><time className="mt-1 block text-xs text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</time></header>
      {item.archive ? <p className="text-sm text-[var(--muted)]">原图 {item.archive.width} × {item.archive.height}，已保存在本机</p> : <div className="flex flex-wrap gap-2">
        <Link className="launcher-detail-primary" href={`/image?historyId=${encodeURIComponent(item.id)}&importMode=generate`}><RotateCcw size={16} />复用参数</Link>
        <Link className="launcher-detail-secondary" href={`/image?historyId=${encodeURIComponent(item.id)}&importMode=img2img`}>图生图</Link>
        <Link className="launcher-detail-secondary" href={`/image?historyId=${encodeURIComponent(item.id)}&importMode=upscale`} prefetch={false}><Maximize2 size={16} />V5 超分</Link>
      </div>}
      {downloadError && <p role="alert" className="text-sm text-[var(--rose)]">{downloadError}</p>}
      {prompt && <ImagePromptSection title="正面提示词" value={prompt} />}{negativePrompt && <ImagePromptSection title="负面提示词" value={negativePrompt} />}
      <ImageMetadataParameters entries={otherParameters} />
    </aside>} />;
}
