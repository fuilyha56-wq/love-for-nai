"use client";

import { ArrowLeft, Download, Eye, Heart, Images, Link2, RotateCcw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
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
  likes: number;
};

const ratingLabels: Record<string, string> = {
  general: "全年龄",
  r13: "R13",
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
  const [revealed, setRevealed] = useState(false);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    (async () => {
      const id = (await params).id;
      try {
        const response = await fetch(`/api/gallery/${id}`, {
          cache: "no-store",
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

  async function copyImageLink() {
    if (!item) return;
    const url = `${window.location.origin}${item.imageUrl}`;
    setMessage(
      (await writeClipboard(url)) ? `图片直链已复制：${url}` : `图片直链：${url}`,
    );
  }

  async function downloadImage() {
    if (!item) return;
    try {
      const response = await fetch(item.imageUrl);
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      const extension = blob.type === "image/jpeg" ? "jpg" : "png";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${item.title || item.id}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(item.imageUrl, "_blank");
    }
  }

  const isHidden = item?.rating === "r18" && !revealed;

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Images size={20} className="shrink-0 text-[var(--rose)]" />
          <b className="truncate">{item?.title || "作品详情"}</b>
        </div>        <Link
          href="/gallery"
          aria-label="返回图片广场"
          className="flex h-9 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold"
        >
          <ArrowLeft size={16} />
          返回广场
        </Link>
      </header>
      <section className="mx-auto max-w-5xl p-4 sm:p-7">
        {message && (
          <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {message}
          </p>
        )}
        {!item && !message && (
          <p className="py-24 text-center text-sm text-[var(--muted)]">
            正在读取作品…
          </p>
        )}
        {item && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
            <div className="relative aspect-[4/5] overflow-hidden rounded-md border border-[var(--line)] bg-[#ebe9e2]">
              <Image
                src={item.imageUrl}
                alt={item.title}
                fill
                unoptimized
                className={`object-contain transition-[filter] duration-200 ${isHidden ? "blur-xl brightness-75" : ""}`}
              />
              {isHidden && (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="absolute inset-0 grid place-items-center bg-[#202328]/35 text-white"
                  aria-label="查看 R18 内容"
                >
                  <span className="flex flex-col items-center gap-2">
                    <Eye size={26} />
                    <b className="rounded-full bg-[#202328]/70 px-3 py-1 text-xs">
                      R18 · 点击查看
                    </b>
                  </span>
                </button>
              )}
              {!isHidden && (
                <a
                  href={item.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-[#202328]/70 text-white"
                  aria-label="在新标签页打开原图"
                  title="在新标签页打开原图"
                >
                  <Link2 size={15} />
                </a>
              )}
            </div>
            <aside className="space-y-4">
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
                  className={`flex h-10 flex-1 items-center justify-center gap-2 rounded border text-sm font-semibold ${liked ? "border-[var(--rose)] bg-[var(--rose)] text-white" : "border-[var(--line)] bg-white text-[var(--rose)]"}`}
                >
                  <Heart size={15} />
                  {item.likes}
                </button>
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded border border-[var(--line)] bg-white text-sm font-semibold"
                >
                  <Link2 size={15} />
                  复制链接
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={copyImageLink}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded border border-[var(--line)] bg-white text-sm font-semibold"
                  title="复制可直接嵌入的图片直链"
                >
                  <Link2 size={15} />
                  图片直链
                </button>
                <button
                  type="button"
                  onClick={downloadImage}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded border border-[var(--line)] bg-white text-sm font-semibold"
                  title="下载原图文件"
                >
                  <Download size={15} />
                  下载原图
                </button>
              </div>
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-[#f1eee7] px-2 py-1 text-[10px]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {Object.keys(item.parameters).length > 0 && (
                <>
                  <Link
                    href={`/image?reuse=1&${new URLSearchParams(
                      Object.entries(item.parameters).map(([key, value]) => [
                        key,
                        String(value),
                      ]),
                    )}`}
                    className="flex h-10 items-center justify-center gap-2 rounded bg-[#292d2c] text-xs font-semibold text-white"
                  >
                    <RotateCcw size={14} />
                    导入全部参数
                  </Link>
                  {item.prompt && (
                    <div className="rounded-md border border-[var(--line)] bg-white p-3 text-xs">
                      <b>正面提示词</b>
                      <p className="mt-1 leading-5 text-[var(--muted)]">
                        {item.prompt}
                      </p>
                    </div>
                  )}
                  {item.negativePrompt && (
                    <div className="rounded-md border border-[var(--line)] bg-white p-3 text-xs">
                      <b>负面提示词</b>
                      <p className="mt-1 leading-5 text-[var(--muted)]">
                        {item.negativePrompt}
                      </p>
                    </div>
                  )}
                </>
              )}
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}
