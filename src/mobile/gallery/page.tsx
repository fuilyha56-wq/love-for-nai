"use client";

import { WorkspaceNav } from "@/mobile/workspace-nav";

import { Eye, EyeOff, Heart, Link2, RotateCcw, SearchX, Send } from "lucide-react";
import Image from "@/mobile/cached-image";
import Link from "next/link";
import { GalleryImportDialog } from "@/app/gallery/gallery-import-dialog";
import { useState } from "react";
import { GallerySubmitDialog, type GallerySubmitForm } from "@/mobile/gallery-submit";
import { CollectionPagination, ImageCardMenu } from "@/mobile/ui/collection-workspace";
import { PublicHeader } from "@/mobile/public-header";
import { PopupSelect } from "@/mobile/ui/popup-select";
import styles from "@/app/ui/discovery-controls.module.css";
import { GalleryFilters } from "@/app/gallery/gallery-filters";
import { useGalleryDiscovery, type GalleryItem } from "@/app/gallery/use-gallery-discovery";

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
    <main onClickCapture={(event) => { const link = event.target instanceof Element ? event.target.closest("a") : null; if (link?.getAttribute("href")?.startsWith("/gallery/")) gallery.rememberPosition(); }} className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PublicHeader current="gallery" extraActions={<button type="button" className="lfn-button is-primary" onClick={() => setSubmitForm({ title: "", authorName: "", rating: "general", source: "local", tags: "", exposeParameters: true })}><Send size={16} />投稿</button>} />
      <WorkspaceNav />
      <section className="mx-auto max-w-7xl p-4 sm:p-7">
        <div className="mb-5"><GalleryFilters
          Select={PopupSelect}
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
        /></div>
        {expired && <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{expired}</p>}
        {message && <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
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
        ) : gallery.total ? <><div className="launcher-gallery-grid">{items.map((item) => {
          const isHidden = (item.rating === "r17" || item.rating === "r18") && !revealed.has(item.id);
          return (
          <article key={item.id} className="launcher-image-card flex flex-col">
            <div className="relative aspect-[4/5] bg-[#141414]">
              <Link href={`/gallery/${item.id}`} tabIndex={isHidden ? -1 : undefined} aria-hidden={isHidden || undefined} className="absolute inset-0 block" aria-label={`查看作品详情：${item.title}`}>
                <Image src={item.thumbnailUrl || `${item.imageUrl}?variant=thumbnail`} alt={item.title} fill unoptimized className={`object-cover transition-[filter] duration-200 ${isHidden ? "blur-xl brightness-75" : ""}`} />
              </Link>
              {isHidden && (
                <button type="button" aria-label={`显示 ${ratingLabel(item.rating)} 作品：${item.title}`} onClick={() => toggleReveal(item.id)} className="absolute inset-0 z-10 grid place-items-center bg-[#202328]/35 text-white">
                  <span className="flex flex-col items-center gap-2">
                    <Eye size={26} aria-hidden="true" />
                    <b className="rounded-full bg-[#202328]/70 px-3 py-1 text-xs">{ratingLabel(item.rating)} · 点击查看</b>
                  </span>
                </button>
              )}
              {!isHidden && <ImageCardMenu label={`作品操作：${item.title}`}><Link href={`/gallery/${item.id}`}><Eye size={17} />查看作品详情</Link><button type="button" onClick={() => setImportItem(item)}><RotateCcw size={17} />导入到画布</button><button type="button" onClick={() => void share(item)}><Link2 size={17} />分享作品</button><button type="button" onClick={() => void like(item.id)}><Heart size={17} />点赞 · {item.likes}</button>{(item.rating === "r17" || item.rating === "r18") && <button type="button" onClick={() => toggleReveal(item.id)}><EyeOff size={17} />重新隐藏内容</button>}</ImageCardMenu>}
            </div>
            <div className="launcher-image-card-caption"><h2 title={item.title}>{item.title}</h2><p>{item.authorName || item.ownerName} · {ratingLabel(item.rating)} · ♥ {item.likes}</p><p>↓ {item.downloads || 0} 次下载 · ↗ {item.uses || 0} 次导入</p></div>
          </article>
          );
        })}</div><CollectionPagination page={gallery.page} pageCount={gallery.pageCount} total={gallery.total} onPageChange={gallery.setPage} /></> : <div className={styles.empty}><SearchX size={28} aria-hidden="true" /><h2>{gallery.query || gallery.tagFilter || gallery.rating !== "all" ? "没有找到相关作品" : "广场暂时还没有作品"}</h2><p>{gallery.query || gallery.tagFilter || gallery.rating !== "all" ? "试试其他关键词，或减少筛选条件。" : "分享你的创作，让灵感在这里相遇。"}</p>{(gallery.query || gallery.tagFilter || gallery.rating !== "all") && <button type="button" className="lfn-button" onClick={gallery.resetFilters}>清空筛选，查看全部作品</button>}</div>}
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
