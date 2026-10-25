"use client";

import { Eye, Heart, Link2, RotateCcw, Trophy } from "lucide-react";
import Image from "@/mobile/cached-image";
import { GalleryImportDialog } from "@/app/gallery/gallery-import-dialog";
import { ImageDetailWorkspace, ImageMetadataParameters, ImagePromptSection } from "@/mobile/ui/image-detail-workspace";
import { ImageDownloadMenu } from "@/mobile/image-download-menu";
import { useEffect, useState } from "react";

type GalleryItem = {
  id: string;
  title: string;
  ownerName: string;
  authorName?: string;
  rating: string;
  source: string;
  tags: string[];
  prompt: string;
  negativePrompt: string;
  parameters: Record<string, unknown>;
  imageUrl: string;
  thumbnailUrl?: string;
  likes: number;
};

const ratingLabels: Record<string, string> = {
  general: "全年龄",
  r13: "R13",
  r17: "R17",
  r18: "R18",
  sensitive: "R13",
};

// navigator.clipboard 仅在 HTTPS 或 localhost 下存在，需要逐级降级。
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒时继续尝试兜底方案。
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}

export default function GalleryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [item, setItem] = useState<GalleryItem | null>(null);
  const [message, setMessage] = useState("");
  const [importItem, setImportItem] = useState<GalleryItem | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [liked, setLiked] = useState(false);
  const [rewardNotice, setRewardNotice] = useState("");
  const [originalImageUrl, setOriginalImageUrl] = useState("");

  useEffect(() => {
    (async () => {
      const id = (await params).id;
      const query = new URLSearchParams(window.location.search);
      if (query.get("reward") === "1") {
        const rank = Number(query.get("rank"));
        setRewardNotice(rank > 0 ? `恭喜获得图库周榜第 ${rank} 名奖励，奖励已发放到你的 AFF 账户。` : "恭喜，图库奖励已发放到你的 AFF 账户。作品已为你高亮显示。");
      }
      try {
        const response = await fetch(`/api/gallery/${id}`, {
          cache: "default",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "作品不存在");
        setItem(result.item);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "作品读取失败");
      }
    })();
  }, [params]);

  async function like() {
    if (!item) return;
    const response = await fetch(`/api/gallery/${item.id}/like`, {
      method: "POST",
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.message || "请登录后点赞");
      return;
    }
    setItem({ ...item, likes: result.likes });
    setLiked(result.liked);
  }

  async function copyLink() {
    if (!item) return;
    const url = window.location.href;
    setMessage(
      (await writeClipboard(url)) ? "分享链接已复制。" : `分享链接：${url}`,
    );
  }

  const isHidden = (item?.rating === "r17" || item?.rating === "r18") && !revealed;

  return <>{importItem && <GalleryImportDialog item={importItem} onClose={() => setImportItem(null)} />}<ImageDetailWorkspace title={item?.title || "作品详情"} backHref="/gallery" backLabel="图片广场" loading={!item && !message} error={!item ? message : undefined}
    notice={(rewardNotice || (item && message)) ? <><span>{rewardNotice && <><Trophy size={18} className="inline-block" /> {rewardNotice}</>}</span>{item && message && <p>{message}</p>}</> : undefined}
    image={item && (<div className={`launcher-detail-image ${rewardNotice ? "ring-4 ring-amber-400 shadow-[0_0_0_8px_rgba(245,158,11,.12)]" : ""}`}>
              <Image
                src={item.imageUrl}
                alt={item.title}
                fill
                unoptimized
                onLoad={(event) => setOriginalImageUrl(event.currentTarget.src)}
                className={`object-contain transition-[filter] duration-200 ${isHidden ? "blur-xl brightness-75" : ""}`}
              />
              {isHidden && (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="absolute inset-0 grid place-items-center bg-[#202328]/35 text-white"
                  aria-label={`查看 ${item.rating.toUpperCase()} 内容`}
                >
                  <span className="flex flex-col items-center gap-2">
                    <Eye size={26} />
                    <b className="rounded-full bg-[#202328]/70 px-3 py-1 text-xs">
                      {item.rating.toUpperCase()} · 点击查看
                    </b>
                  </span>
                </button>
              )}
              {!isHidden && (
                <a
                  href={originalImageUrl || undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-[#202328]/70 text-white"
                  aria-label="在新标签页打开原图"
                  title="在新标签页打开原图"
                >
                  <Link2 size={15} />
                </a>
              )}
            </div>)}
    metadata={item && (<aside className="space-y-4">
              <div>
                <h1 className="font-[var(--font-display)] text-2xl font-semibold">
                  {item.title}
                </h1>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  作者：{item.authorName || item.ownerName}
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                  上传者：{item.ownerName} ·{" "}
                  {ratingLabels[item.rating] || item.rating} · {item.source}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={like}
                  aria-label={liked ? "已点赞" : "点赞作品"}
                  aria-pressed={liked}
                  className={`flex h-10 flex-1 items-center justify-center gap-2 rounded border text-sm font-semibold ${liked ? "border-[var(--rose)] bg-[var(--rose)] text-white" : "border-[var(--line)] bg-[var(--panel)] text-[var(--rose)]"}`}
                >
                  <Heart size={15} />
                  {item.likes}
                </button>
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded border border-[var(--line)] bg-[var(--panel)] text-sm font-semibold"
                >
                  <Link2 size={15} />
                  复制链接
                </button>
              </div>
              <div className="flex gap-2">
                <ImageDownloadMenu src={item.imageUrl} filename={item.title || item.id} className="gallery-download-menu" label="下载图片" title="选择图片下载方式" onDownloaded={() => { void fetch(`/api/gallery/${encodeURIComponent(item.id)}/download`, { method: "POST" }); }} />
              </div>
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[10px]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button" onClick={() => setImportItem(item)}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded bg-[#292d2c] text-xs font-semibold text-white"
                >
                  <RotateCcw size={14} />
                  导入图片到工作台
                </button>
              </div>
              {Object.keys(item.parameters).length > 0 && (
                <>
                  {item.prompt && <ImagePromptSection title="正面提示词" value={item.prompt} />}
                  {item.negativePrompt && <ImagePromptSection title="负面提示词" value={item.negativePrompt} />}
                </>
              )}
            {Object.keys(item.parameters).length > 0 && <ImageMetadataParameters entries={Object.entries(item.parameters).filter(([key]) => key !== "prompt" && key !== "negative_prompt")} />}
            </aside>)} /></>;
}
