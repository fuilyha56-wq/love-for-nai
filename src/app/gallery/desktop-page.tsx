"use client";

import { WorkspaceNav } from "@/app/workspace-nav";

import { Eye, EyeOff, Heart, Link2, RotateCcw, SearchX, Send } from "lucide-react";
import Image from "@/app/cached-image";
import Link from "next/link";
import { GalleryImportDialog } from "@/app/gallery/gallery-import-dialog";
import { useState } from "react";
import { GallerySubmitDialog, type GallerySubmitForm } from "@/app/gallery-submit";
import { PublicHeader } from "@/app/public-header";
import { GalleryFilters } from "./gallery-filters";
import { useGalleryDiscovery, type GalleryItem } from "./use-gallery-discovery";
import styles from "@/app/ui/discovery-controls.module.css";

const ratingLabels: Record<string, string> = { general: "全年龄", r13: "R13", r17: "R17", r18: "R18", sensitive: "R13" };
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
  const gallery = useGalleryDiscovery();
  const { items, loadState, error } = gallery;
  const [message, setMessage] = useState("");
  const [importItem, setImportItem] = useState<GalleryItem | null>(null);
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
  async function like(id: string) {
    try {
      const response = await fetch(`/api/gallery/${id}/like`, { method: "POST" });
      const result = (await response.json()) as { message?: string; likes?: number };
      if (!response.ok) { setMessage(result.message || "请登录后点赞"); return; }
      if (typeof result.likes === "number")
        gallery.setItems((current) => current.map((item) => item.id === id ? { ...item, likes: result.likes as number } : item));
      if (gallery.sort === "likes") gallery.refresh();
    } catch {
      setMessage("点赞失败，请稍后重试");
    }
  }
  async function share(item: GalleryItem) {
    const url = `${window.location.origin}/gallery/${item.id}`;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else setMessage((await writeClipboard(url)) ? `分享链接已复制：${url}` : `分享链接：${url}`);
    } catch { setMessage("分享链接：" + url); }
  }
  return (
    <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader
        current="gallery"
        actionLabel="进入工作台"
        actionHref="/image"
        extraActions={<button type="button" onClick={() => setSubmitForm({ title: "", authorName: "", rating: "general", source: "local", tags: "", exposeParameters: true })} className="flex h-9 shrink-0 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--panel)] px-2.5 text-xs font-semibold text-[var(--rose)] sm:px-3"><Send size={14} /><span className="hidden sm:inline">投稿作品</span><span className="sm:hidden">投稿</span></button>}
      />
      <WorkspaceNav />
      <section className="mx-auto max-w-7xl p-4 sm:p-7">
        {expired && <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{expired}</p>}
        {message && <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
        <div className="mb-6">
          <GalleryFilters
            query={gallery.query}
            onQueryChange={gallery.setQuery}
            tagFilter={gallery.tagFilter}
            onTagFilterChange={gallery.setTagFilter}
            tagSuggestions={gallery.tagSuggestions}
            rating={gallery.rating}
            onRatingChange={gallery.setRating}
            sort={gallery.sort}
            onSortChange={gallery.setSort}
            total={gallery.total}
            loading={loadState === "loading"}
            onReset={gallery.resetFilters}
            onRefresh={gallery.refresh}
          />
        </div>
        {loadState === "loading" && items.length > 0 && <p className="mb-3 text-xs text-[var(--muted)]" role="status">正在更新筛选结果…</p>}
        {loadState === "error" ? (
          <div className="py-24 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button type="button" onClick={gallery.refresh} className="mt-4 inline-flex h-9 items-center gap-2 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm font-semibold hover:border-[var(--rose)]">
              <RotateCcw size={15} />重试
            </button>
          </div>
        ) : loadState === "loading" && !items.length ? (
          <p className="py-24 text-center text-sm text-[var(--muted)]">正在加载图库…</p>
        ) : items.length ? <><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items.map((item) => {
          const isHidden = (item.rating === "r17" || item.rating === "r18") && !revealed.has(item.id);
          return (
          <article key={item.id} className="flex flex-col overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel)]">
            <div className="relative aspect-[4/5] bg-[var(--surface-muted)]">
              <Link href={`/gallery/${item.id}`} tabIndex={isHidden ? -1 : undefined} aria-hidden={isHidden || undefined} className="absolute inset-0 block" aria-label={`查看作品详情：${item.title}`}>
                <Image src={item.thumbnailUrl || `${item.imageUrl}?variant=thumbnail`} alt={item.title} fill unoptimized className={`object-contain transition-[filter] duration-200 ${isHidden ? "blur-xl brightness-75" : ""}`} />
              </Link>
              {isHidden && (
                <button type="button" aria-label={`显示 ${ratingLabel(item.rating)} 作品：${item.title}`} onClick={() => toggleReveal(item.id)} className="absolute inset-0 z-10 grid place-items-center bg-[#202328]/35 text-white">
                  <span className="flex flex-col items-center gap-2">
                    <Eye size={26} aria-hidden="true" />
                    <b className="rounded-full bg-[#202328]/70 px-3 py-1 text-xs">{ratingLabel(item.rating)} · 点击查看</b>
                  </span>
                </button>
              )}
              {!isHidden && (item.rating === "r17" || item.rating === "r18") && (
                <button type="button" onClick={() => toggleReveal(item.id)} className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-[#202328]/70 text-white" aria-label="重新隐藏 R18 内容" title="重新打码">
                  <EyeOff size={15} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="flex flex-1 flex-col p-3">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="line-clamp-2 font-semibold" title={item.title}>{item.title}</h2><p className="mt-1 text-xs text-[var(--muted)]">作者：{item.authorName || item.ownerName}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">上传者：{item.ownerName} · {ratingLabel(item.rating)} · {item.source}</p></div><div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => share(item)} className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--rose)]" title="复制分享链接" aria-label={`分享作品：${item.title}`}><Link2 size={15} aria-hidden="true" /></button><button type="button" onClick={() => like(item.id)} className="flex items-center gap-1 text-xs text-[var(--rose)]" aria-label={`点赞作品：${item.title}`}><Heart size={15} aria-hidden="true" />{item.likes}</button></div></div>
              <p className="mt-2 text-[10px] text-[var(--muted)]">↓ {item.downloads || 0} 次下载 · ↗ {item.uses || 0} 次导入</p>
              <div className="mt-3 flex min-h-[26px] flex-wrap gap-1">{item.tags.map((tag) => <span key={tag} className="rounded bg-[var(--surface-muted)] px-2 py-1 text-[10px]">{tag}</span>)}</div>
              <div className="mt-auto pt-4">
                <button type="button" onClick={() => setImportItem(item)} className="flex h-9 w-full items-center justify-center gap-2 rounded bg-[#292d2c] text-xs font-semibold text-white"><RotateCcw size={14} />导入图片到工作台</button>
              </div>
            </div>
          </article>
          );
        })}</div><nav className="mt-7 flex items-center justify-center gap-4 text-sm" aria-label="图片广场分页"><button type="button" className="rounded border border-[var(--line)] px-3 py-2 disabled:opacity-40" disabled={gallery.page <= 1} onClick={() => gallery.setPage(gallery.page - 1)}>上一页</button><span aria-live="polite">第 {gallery.page} / {gallery.pageCount} 页 · 共 {gallery.total} 件</span><button type="button" className="rounded border border-[var(--line)] px-3 py-2 disabled:opacity-40" disabled={gallery.page >= gallery.pageCount} onClick={() => gallery.setPage(gallery.page + 1)}>下一页</button></nav></> : <div className={styles.empty}><SearchX size={28} aria-hidden="true" /><h2>{gallery.query || gallery.tagFilter || gallery.rating !== "all" ? "没有找到相关作品" : "广场暂时还没有作品"}</h2><p>{gallery.query || gallery.tagFilter || gallery.rating !== "all" ? "试试其他关键词，或减少筛选条件。" : "分享你的创作，让灵感在这里相遇。"}</p>{(gallery.query || gallery.tagFilter || gallery.rating !== "all") && <button type="button" className="lfn-button" onClick={gallery.resetFilters}>清空筛选，查看全部作品</button>}</div>}
      </section>
      {submitForm && (
        <GallerySubmitDialog
          form={submitForm}
          onChange={setSubmitForm}
          onClose={() => setSubmitForm(null)}
          onPublished={() => {
            setMessage("图片已提交审核，审核通过后会发布到图片广场。");
            gallery.refresh();
          }}
          onSessionExpired={(sessionMessage) => setExpired(sessionMessage)}
        />
      )}
      {importItem && <GalleryImportDialog item={importItem} onClose={() => setImportItem(null)} />}
    </main>
  );
}
