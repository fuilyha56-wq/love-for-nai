"use client";

import { ImageDetailWorkspace, ImageMetadataParameters, ImagePromptSection } from "@/mobile/ui/image-detail-workspace";
import { RotateCcw } from "lucide-react";
import Image from "@/mobile/cached-image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { findLocalImageHistory } from "@/lib/local-image-history";
import { ImageDownloadMenu } from "@/mobile/image-download-menu";

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
    let objectUrl = "";
    void (async () => {
      try {
        const { id } = await params;
        const local = await findLocalImageHistory(id).catch(() => null);
        if (local) {
          objectUrl = URL.createObjectURL(local.image);
          setItem({
            id: local.remoteId || id,
            createdAt: new Date(local.createdAt).toISOString(),
            imageUrl: objectUrl,
            parameters: (local.parameters || { prompt: local.prompt || "", negative_prompt: local.negative || "", model: local.model || "", operation: local.operation || "generate" }) as HistoryItem["parameters"],
          });
          return;
        }
        const response = await fetch(`/api/history/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as HistoryItem & { message?: string };
        if (!response.ok) throw new Error(result.message || "读取历史失败");
        setItem(result);
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "读取历史失败");
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params]);

  const parameters = item?.parameters || {};
  const prompt = String(parameters.prompt || "");
  const negativePrompt = String(parameters.negative_prompt || "");
  const otherParameters = Object.entries(parameters).filter(([key]) => !promptKeys.has(key));

  return <ImageDetailWorkspace title="历史图片" backHref="/history" backLabel="图片历史" loading={!item && !message} error={message}
    image={item && <div className="launcher-detail-image"><Image src={item.imageUrl} alt="历史生成图片" fill unoptimized className="object-contain" /><ImageDownloadMenu src={item.imageUrl} filename={`lfn-${item.id}`} className="absolute right-3 top-3 history-detail-download" title="选择图片下载方式" /></div>}
    metadata={item && <aside><header><h2 className="text-lg font-semibold">生成参数</h2><time className="mt-1 block text-xs text-[var(--muted)]">{new Date(item.createdAt).toLocaleString("zh-CN")}</time></header>
      <div className="flex flex-wrap gap-2"><Link className="launcher-detail-primary" href={`/image?historyId=${encodeURIComponent(item.id)}&importMode=generate`}><RotateCcw size={16} />复用参数</Link><Link className="launcher-detail-secondary" href={`/image?historyId=${encodeURIComponent(item.id)}&importMode=img2img`}>图生图</Link></div>
      {prompt && <ImagePromptSection title="正面提示词" value={prompt} />}{negativePrompt && <ImagePromptSection title="负面提示词" value={negativePrompt} />}
      <ImageMetadataParameters entries={otherParameters} />
    </aside>} />;
}
