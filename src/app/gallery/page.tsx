"use client";

import { ArrowLeft, Eye, EyeOff, Heart, Images, Link2, RotateCcw, Send } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GallerySubmitDialog, type GallerySubmitForm } from "@/app/gallery-submit";

type GalleryItem = {
  id: string; title: string; ownerName: string; authorName?: string; rating: string; source: string; tags: string[];
  parameters: Record<string, unknown>; imageUrl: string; likes: number;
};

function importHref(item: GalleryItem): string {
  const params = new URLSearchParams({ reuse: "1" });
  for (const [key, value] of Object.entries(item.parameters)) params.set(key, String(value));
  return `/image?${params}`;
}

const ratingLabels: Record<string, string> = { general: "全年龄", r13: "R13", r18: "R18", sensitive: "R13" };
function ratingLabel(rating: string): string { return ratingLabels[rating] || rating; }

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

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [submitForm, setSubmitForm] = useState<GallerySubmitForm | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  function toggleReveal(id: string) {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  useEffect(() => {
    fetch("/api/gallery", { cache: "no-store" }).then((response) => response.json())
      .then((result) => setItems(result.items || [])).catch(() => setMessage("图库读取失败，请稍后重试"));
  }, []);
  async function like(id: string) {
    const response = await fetch(`/api/gallery/${id}/like`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) { setMessage(result.message || "请登录后点赞"); return; }
    setItems((current) => current.map((item) => item.id === id ? { ...item, likes: result.likes } : item));
  }
  async function share(item: GalleryItem) {
    const url = `${window.location.origin}/gallery/${item.id}`;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else setMessage((await writeClipboard(url)) ? `分享链接已复制：${url}` : `分享链接：${url}`);
    } catch { setMessage("分享链接：" + url); }
  }
  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3"><Images size={20} className="shrink-0 text-[var(--rose)]" /><b className="truncate">图片广场</b><span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline">R18 默认打码</span></div>
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          <button type="button" onClick={() => setSubmitForm({ title: "", authorName: "", rating: "general", source: "local", tags: "", exposeParameters: true })} className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-2.5 text-sm font-semibold text-[var(--rose)] sm:gap-2 sm:px-3"><Send size={15} /><span className="hidden sm:inline">投稿作品</span><span className="sm:hidden">投稿</span></button>
          <Link href="/image" aria-label="返回工作台" className="grid h-9 w-9 place-items-center rounded border border-[var(--line)] bg-white sm:flex sm:h-9 sm:w-auto sm:items-center sm:gap-2 sm:px-3 sm:text-sm sm:font-semibold"><ArrowLeft size={16} /><span className="hidden sm:inline">返回工作台</span></Link>
        </div>
      </header>
      <section className="mx-auto max-w-7xl p-4 sm:p-7">
        {expired && <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{expired}</p>}
        {message && <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
        {items.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items.map((item) => {
          const isHidden = item.rating === "r18" && !revealed.has(item.id);
          return (
          <article key={item.id} className="flex flex-col overflow-hidden rounded-md border border-[var(--line)] bg-white">
            <Link href={`/gallery/${item.id}`} className="relative block aspect-[4/5] bg-[#ebe9e2]" aria-label={`查看作品详情：${item.title}`}>
              <Image src={item.imageUrl} alt={item.title} fill unoptimized className={`object-contain transition-[filter] duration-200 ${isHidden ? "blur-xl brightness-75" : ""}`} />
              {isHidden && (
                <span role="button" tabIndex={0} onClick={(event) => { event.preventDefault(); toggleReveal(item.id); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); toggleReveal(item.id); } }} className="absolute inset-0 grid place-items-center bg-[#202328]/35 text-white">
                  <span className="flex flex-col items-center gap-2">
                    <Eye size={26} />
                    <b className="rounded-full bg-[#202328]/70 px-3 py-1 text-xs">R18 · 点击查看</b>
                  </span>
                </span>
              )}
              {!isHidden && item.rating === "r18" && (
                <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleReveal(item.id); }} className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-[#202328]/70 text-white" aria-label="重新隐藏 R18 内容" title="重新打码">
                  <EyeOff size={15} />
                </button>
              )}
            </Link>
            <div className="flex flex-1 flex-col p-3">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="line-clamp-2 font-semibold" title={item.title}>{item.title}</h2><p className="mt-1 text-xs text-[var(--muted)]">作者：{item.authorName || item.ownerName}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">上传者：{item.ownerName} · {ratingLabel(item.rating)} · {item.source}</p></div><div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => share(item)} className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--rose)]" title="复制分享链接"><Link2 size={15} /></button><button type="button" onClick={() => like(item.id)} className="flex items-center gap-1 text-xs text-[var(--rose)]"><Heart size={15} />{item.likes}</button></div></div>
              <div className="mt-3 flex min-h-[26px] flex-wrap gap-1">{item.tags.map((tag) => <span key={tag} className="rounded bg-[#f1eee7] px-2 py-1 text-[10px]">{tag}</span>)}</div>
              <div className="mt-auto pt-4">
                {Object.keys(item.parameters).length > 0 ? <Link href={importHref(item)} className="flex h-9 items-center justify-center gap-2 rounded bg-[#292d2c] text-xs font-semibold text-white"><RotateCcw size={14} />导入全部参数</Link> : <p className="flex h-9 items-center justify-center rounded border border-dashed border-[var(--line)] text-xs text-[var(--muted)]">作者未公开详细参数</p>}
              </div>
            </div>
          </article>
          );
        })}</div> : <div className="py-24 text-center text-sm text-[var(--muted)]">{message || "广场暂时还没有作品"}</div>}
      </section>
      {submitForm && (
        <GallerySubmitDialog
          form={submitForm}
          onChange={setSubmitForm}
          onClose={() => setSubmitForm(null)}
          onPublished={() => {
            setMessage("作品已发布到图片广场。");
            fetch("/api/gallery", { cache: "no-store" }).then((response) => response.json())
              .then((result) => setItems(result.items || [])).catch(() => undefined);
          }}
          onSessionExpired={(sessionMessage) => setExpired(sessionMessage)}
        />
      )}
    </main>
  );
}