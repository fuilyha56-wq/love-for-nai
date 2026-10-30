"use client";
import { GalleryPublicationEditor } from "@/app/ui/gallery-publication-editor";
import { readImageCharacterPrompts } from "@/lib/image-character-prompts";

import { Eye, Heart, Link2, RotateCcw, Trophy } from "lucide-react";
import Image from "@/mobile/cached-image";
import { DiscussionComments } from "@/mobile/gallery/discussion-comments";
import { GalleryImportDialog } from "@/mobile/gallery/gallery-import-dialog";
import { ImageDetailWorkspace, ImageMetadataParameters, ImagePromptSection } from "@/mobile/ui/image-detail-workspace";
import { ImageDownloadMenu } from "@/mobile/image-download-menu";
import { useEffect, useState } from "react";

type GalleryItem = {
  noOriginalData?: boolean;
  promptMode?: string;
  originalFileName?: string;
  ownerId?: number;
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
  liked?: boolean;
  parametersLocked?: boolean;
  requireLikeForParameters?: boolean;
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
    window.scrollTo({ top: 0, behavior: "instant" });
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
        setLiked(result.item.liked === true);
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
    if (item.requireLikeForParameters) {
      const detail = await fetch(`/api/gallery/${item.id}`, { cache: "no-store" });
      if (!detail.ok) { setMessage("点赞状态已更新，作品详情读取失败，请刷新重试。"); return; }
      const refreshed = await detail.json();
      setItem(refreshed.item);
    } else setItem({ ...item, likes: result.likes });
    setLiked(result.liked);
  }

  async function copyLink() {
    if (!item) return;
    const url = window.location.href;
    setMessage(
      (await writeClipboard(url)) ? "分享链接已复制。" : `分享链接：${url}`,
    );
  }

  const characterPrompts = readImageCharacterPrompts(item?.parameters || {});
  const isHidden = (item?.rating === "r17" || item?.rating === "r18") && !revealed;

  return <>{importItem && <GalleryImportDialog item={importItem} onClose={() => setImportItem(null)} />}<ImageDetailWorkspace presentation="details" title={item?.title || "作品详情"} backHref="/gallery?restore=1" backLabel="图片广场" loading={!item && !message} error={!item ? message : undefined}
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
                </h1>{item.originalFileName && <p className="break-all text-xs text-[var(--muted)]">原文件：{item.originalFileName}</p>}{item.noOriginalData && <p className="text-sm text-[var(--muted)]">无原数据图 · 不公开原始提示词</p>}{item.promptMode === "partial" && <p className="text-sm text-[var(--muted)]">部分提示词公开 · 已通过来源删减校验</p>}<GalleryPublicationEditor item={item} />
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
              {item.parametersLocked && <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-sm"><p>作者设置了点赞后查看提示词与生成参数。</p><button type="button" onClick={like} className="mt-3 flex min-h-11 items-center gap-2 rounded bg-[var(--rose)] px-4 font-semibold text-white"><Heart size={16} />点赞并查看提示词</button></div>}
              {item.prompt && <ImagePromptSection title="正面提示词" value={item.prompt} />}
              {item.negativePrompt && <ImagePromptSection title="负面提示词" value={item.negativePrompt} />}
              {characterPrompts.map((character, index) => <section key={index} aria-label={`角色 ${index + 1} 提示词`} className="space-y-2">
                <h2 className="text-sm font-semibold">角色 {index + 1}</h2>
                {character.prompt && <ImagePromptSection title={`角色 ${index + 1} 正面提示词`} value={character.prompt} />}
                {character.negativePrompt && <ImagePromptSection title={`角色 ${index + 1} 负面提示词`} value={character.negativePrompt} />}
              </section>)}
            {Object.keys(item.parameters).length > 0 && <ImageMetadataParameters entries={Object.entries(item.parameters).filter(([key]) => !["prompt", "negative_prompt", "characterPrompts", "characters", "v4_prompt", "v4_negative_prompt"].includes(key))} />}
            </aside>)}>{item && <DiscussionComments resource="gallery" resourceId={item.id} />}</ImageDetailWorkspace></>;
}
