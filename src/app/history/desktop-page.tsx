"use client";
import { lfnConfirm } from "@/app/ui/lfn-dialog";


import { WorkspaceNav } from "@/app/workspace-nav";

import {
  ArrowLeft,
  Check,
  CheckSquare,
  Download,
  History,
  Info,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import Image from "@/app/cached-image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";
import { GallerySubmitDialog, type GallerySubmitForm } from "@/app/gallery-submit";
import { deleteLocalImageHistory, listLocalImageHistorySummaries } from "@/lib/local-image-history";
import { ImageDownloadMenu } from "@/app/image-download-menu";
import { deleteCachedImage, fetchCachedImageBlob } from "@/lib/browser-image-cache";

import { mergeHistoryListItems, type HistoryListItem as HistoryItem } from "@/lib/history-list-items";

function importHref(item: HistoryItem, mode: "img2img" | "generate") {
  const params = new URLSearchParams({ historyId: item.id, importMode: mode });
  return `/image?${params.toString()}`;
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [galleryForm, setGalleryForm] = useState<GallerySubmitForm | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<HistoryItem | null>(null);
  const [previewSrc, setPreviewSrc] = useState("");
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  const [importMenu, setImportMenu] = useState<{ item: HistoryItem; top: number; left: number } | null>(null);
  const importMenuTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      const result = await readJson<{ userId?: number; items?: HistoryItem[] }>(
        await fetch("/api/history", { cache: "no-store", signal: controller.signal }), "读取历史失败",
      );
      const local = await listLocalImageHistorySummaries().catch(() => []);
      if (!active) return;
      const merged = mergeHistoryListItems(result.items || [], local, Number(result.userId));
      setLocalUrls(merged.localSources);
      setItems(merged.items);
    })().catch((error) => {
      if (!active || (error instanceof Error && error.name === "AbortError")) return;
      if (error instanceof SessionExpiredError) setExpired(error.message);
      else setMessage(error instanceof Error ? error.message : "读取历史失败");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, []);

  function imageSrc(item: HistoryItem) {
    return localUrls[item.id] || item.imageUrl;
  }

  function openPreview(item: HistoryItem) {
    setPreviewLoaded(false);
    setPreviewSrc(imageSrc(item));
    setPreview(item);
  }

  async function openGallerySubmission(item: HistoryItem) {
    try {
      const blob = item.account ? null : await fetchCachedImageBlob(imageSrc(item));
      const file = blob ? new File([blob], `history-${item.id}.${blob.type === "image/jpeg" ? "jpg" : "png"}`, { type: blob.type }) : undefined;
      setGalleryForm({ historyId: item.account ? item.id : undefined, file, title: item.parameters.prompt?.toString().slice(0, 40) || "未命名作品", authorName: "", rating: "general", source: item.account ? "lfn" : "local", tags: "", exposeParameters: true });
    } catch (error) { setMessage(error instanceof Error ? error.message : "读取历史图片失败"); }
  }

  function closePreview() {
    setPreview(null);
    setPreviewSrc("");
  }

  function togglePrompt(id: string) {
    setExpandedPrompts((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function showImportMenu(item: HistoryItem, element: HTMLDivElement) {
    if (importMenuTimer.current) window.clearTimeout(importMenuTimer.current);
    const rect = element.getBoundingClientRect();
    setImportMenu({ item, top: rect.bottom + 6, left: rect.left + rect.width / 2 });
  }

  function hideImportMenuSoon() {
    if (importMenuTimer.current) window.clearTimeout(importMenuTimer.current);
    importMenuTimer.current = window.setTimeout(() => setImportMenu(null), 180);
  }

  async function remove(id: string) {
    if (!(await lfnConfirm("确认删除这张历史图片？删除后无法恢复。"))) return;
    const deletedItem = items.find((item) => item.id === id);
    if (deletedItem?.account) {
      const response = await fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json();
        setMessage(result.message || "删除失败");
        return;
      }
    }
    const localCopies = await listLocalImageHistorySummaries().catch(() => []);
    await Promise.all(localCopies.filter((entry) => (entry.remoteId || entry.id) === id).map((entry) => deleteLocalImageHistory(entry.id).catch(() => undefined)));
    await deleteCachedImage(`/api/history/${encodeURIComponent(id)}/image`).catch(() => undefined);
    setItems((current) => current.filter((item) => item.id !== id));
    setLocalUrls((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  // 批量打包：直接取服务端原始 PNG 字节放入 ZIP（STORE 不二次压缩、
  // 也不经 canvas 重编码），RGBA 通道信息完全保留，像素级无损。
  async function downloadSelectedZip(stripMetadata = false) {
    if (!selected.size || zipping) return;
    setZipping(true);
    setMessage("");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const used = new Set<string>();
      let failed = 0;
      for (const id of selected) {
        const item = items.find((entry) => entry.id === id);
        if (!item) continue;
        try {
          let blob = await fetchCachedImageBlob(imageSrc(item));
          if (stripMetadata) {
            const cleaned = await fetch("/api/images/metadata-strip", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
            if (!cleaned.ok) throw new Error("清理图片数据失败");
            blob = await cleaned.blob();
          }
          const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
          let name = `lfn-${id}.${ext}`;
          let counter = 1;
          while (used.has(name)) name = `lfn-${id}-${counter++}.${ext}`;
          used.add(name);
          zip.file(name, blob);
        } catch {
          failed += 1;
        }
      }
      const content = await zip.generateAsync({
        type: "blob",
        // STORE：PNG 已是压缩格式，存储模式不重压，保真且最快。
        compression: "STORE",
      });
      const url = URL.createObjectURL(content);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `lfn-images-${new Date()
        .toISOString()
        .slice(0, 10)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(
        failed
          ? `已打包 ${selected.size - failed} 张（${failed} 张读取失败）。`
          : `已打包 ${selected.size} 张${stripMetadata ? "已清理 NAI 数据" : "原始"}图片。`,
      );
      exitSelectMode();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "打包失败，请重试");
    } finally {
      setZipping(false);
    }
  }

  async function deleteSelected() {
    if (!selected.size || zipping) return;
    if (!(await lfnConfirm(`确认删除选中的 ${selected.size} 张历史图片？删除后无法恢复。`))) return;
    setZipping(true);
    try {
      const ids = [...selected];
      const remoteIds = items.filter((item) => selected.has(item.id) && item.account).map((item) => item.id);
      for (let offset = 0; offset < remoteIds.length; offset += 100) {
        const response = await fetch("/api/history", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: remoteIds.slice(offset, offset + 100) }) });
        const result = await response.json().catch(() => ({})) as { message?: string };
        if (!response.ok) throw new Error(result.message || "批量删除失败");
      }
      const localCopies = await listLocalImageHistorySummaries().catch(() => []);
      await Promise.all(localCopies.filter((entry) => selected.has(entry.remoteId || entry.id)).map((entry) => deleteLocalImageHistory(entry.id).catch(() => undefined)));
      await Promise.all(ids.map((id) => deleteCachedImage(`/api/history/${encodeURIComponent(id)}/image`).catch(() => undefined)));
      setItems((current) => current.filter((item) => !selected.has(item.id)));
      setLocalUrls((current) => { const next = { ...current }; ids.forEach((id) => delete next[id]); return next; });
      setMessage(`已删除 ${ids.length} 张图片。`);
      exitSelectMode();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量删除失败");
    } finally { setZipping(false); }
  }

  return (
    <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <History size={20} className="text-[var(--rose)]" />
          <b>图片历史</b>
          <span className="text-xs text-[var(--muted)]">共 {items.length} 张</span>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className="ml-2 flex h-8 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold hover:border-[var(--rose)]"
            >
              {selectMode ? (
                <>
                  <X size={14} /> 退出多选
                </>
              ) : (
                <>
                  <CheckSquare size={14} /> 批量管理
                </>
              )}
            </button>
          )}
        </div>
        <Link
          href="/image"
          className="flex items-center gap-2 text-sm font-semibold"
        >
              <ArrowLeft size={16} /> 返回工作台
            </Link>
          </header>
      <WorkspaceNav />
          {selectMode && (
            <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-4 py-2 sm:px-7">
              <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                <button
                  type="button"
                  onClick={() =>
                    setSelected((current) =>
                      current.size === items.length
                        ? new Set()
                        : new Set(items.map((item) => item.id)),
                    )
                  }
                  className="flex h-8 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-3 font-semibold hover:border-[var(--rose)]"
                >
                  <CheckSquare size={14} />
                  {selected.size === items.length ? "取消全选" : "全选"}
                </button>
                <span>
                  已选 {selected.size} / {items.length} 张
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void downloadSelectedZip(false)} disabled={!selected.size || zipping} className="flex h-8 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold disabled:opacity-50"><Download size={14} />原图 ZIP</button>
                <button type="button" onClick={() => void downloadSelectedZip(true)} disabled={!selected.size || zipping} className="flex h-8 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold disabled:opacity-50">清理数据 ZIP</button>
                <button type="button" onClick={() => void deleteSelected()} disabled={!selected.size || zipping} className="flex h-8 items-center gap-1.5 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50"><Trash2 size={14} />删除（{selected.size}）</button>
              </div>
            </div>
          )}
      <section className="mx-auto max-w-7xl p-4 sm:p-7">
        {expired && <SessionExpiredNotice message={expired} />}
        {message && (
          <div className="mb-4 rounded border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
            {message}
          </div>
        )}
        {expired ? null : loading ? (
          <p className="py-20 text-center text-sm text-[var(--muted)]">
            正在读取历史…
          </p>
        ) : items.length ? (
          <div className="history-grid">
            {items.map((item) => (
              <article
                key={item.id}
                className="history-card overflow-hidden rounded-md border border-[var(--line)] bg-white"
              >
                <div
                  className={`history-image-frame bg-[#ebe9e2] ${
                    selectMode ? "cursor-pointer" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="history-image-button"
                    aria-label="放大查看历史图片"
                    onClick={selectMode ? () => toggleSelect(item.id) : () => openPreview(item)}
                  >
                    <Image
                      src={item.thumbnailUrl || (item.imageUrl?.startsWith("/api/history/") ? `${item.imageUrl}${item.imageUrl.includes("?") ? "&" : "?"}variant=thumbnail` : imageSrc(item))}
                      alt="历史生成图片"
                      width={512}
                      height={512}
                      unoptimized
                      className={selectMode && selected.has(item.id) ? "opacity-60" : ""}
                    />
                  </button>
                  {selectMode && (
                    <span
                      className={`absolute left-2 top-2 grid h-7 w-7 place-items-center rounded border-2 ${
                        selected.has(item.id)
                          ? "border-[var(--rose)] bg-[var(--rose)] text-white"
                          : "border-white/80 bg-black/25 text-transparent"
                      }`}
                      aria-hidden="true"
                    >
                      {selected.has(item.id) && <Check size={16} />}
                    </span>
                  )}
                </div>
                <div className="history-card-content">
                  <div className="history-prompt-slot">
                  <button
                    type="button"
                    className={`history-prompt-preview min-h-10 text-left text-xs leading-5 ${expandedPrompts.has(item.id) ? "is-expanded" : "line-clamp-2"}`}
                    title={expandedPrompts.has(item.id) ? "收起提示词" : "展开完整提示词"}
                    aria-expanded={expandedPrompts.has(item.id)}
                    onClick={() => togglePrompt(item.id)}
                  >
                    {item.parameters.prompt || "未记录提示词"}
                  </button>
                  </div>
                  <div className="history-card-metadata flex justify-between text-[10px] text-[var(--muted)]">
                    <span>{item.parameters.model || "未知模型"}</span>
                    <time>
                      {new Date(item.createdAt).toLocaleString("zh-CN")}
                    </time>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <div className="history-import-group" title="导入图片到工作台" onMouseEnter={(event) => showImportMenu(item, event.currentTarget)} onMouseLeave={hideImportMenuSoon} onFocus={(event) => showImportMenu(item, event.currentTarget)}>
                      <Link href={importHref(item, "img2img")} className="history-action" aria-label="导入为图生图">
                        <RotateCcw size={15} />
                      </Link>
                    </div>
                    <Link href={`/history/${encodeURIComponent(item.id)}`} className="history-action" title="查看完整请求参数" aria-label="查看完整请求参数"><Info size={15} /></Link>
                    <ImageDownloadMenu src={imageSrc(item)} filename={`lfn-${item.id}`} className="history-action" title="下载图片" />
                    <button
                      type="button"
                      onClick={() => void openGallerySubmission(item)}
                      className="history-action"
                      title="提交到图片广场"
                    >
                      <Send size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      className="history-action text-[var(--rose)]"
                      title="删除历史"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="py-24 text-center">
            <History size={34} className="mx-auto text-[var(--muted)]" />
            <h1 className="mt-4 text-xl font-semibold">还没有生成历史</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              生成成功的图片会自动保留在这里。
            </p>
          </div>
        )}
      </section>
      {galleryForm && (
        <GallerySubmitDialog
          form={galleryForm}
          onChange={setGalleryForm}
          onClose={() => setGalleryForm(null)}
          onPublished={() => setMessage("图片已提交审核，审核通过后会发布到图片广场。")}
          onSessionExpired={(sessionMessage) => setExpired(sessionMessage)}
        />
      )}
      {preview && typeof document !== "undefined" && createPortal((
        <div className="history-lightbox" role="dialog" aria-modal="true" aria-label="历史图片预览" onClick={closePreview}>
          <div className={`history-lightbox-surface ${previewLoaded ? "" : "is-loading"}`} onClick={(event) => event.stopPropagation()}>
            <Image
              src={previewSrc || preview.imageUrl}
              alt="放大后的历史生成图片"
              loading="eager"
              onLoad={() => setPreviewLoaded(true)}
              onError={() => {
                if (previewSrc !== preview.imageUrl) setPreviewSrc(preview.imageUrl);
              }}
            />
            {!previewLoaded && <span className="history-lightbox-loading">正在加载原图…</span>}
            <button type="button" className="history-lightbox-close" aria-label="关闭图片预览" onClick={closePreview}><X size={18} /></button>
          </div>
        </div>
      ), document.body)}
      {importMenu && typeof document !== "undefined" && createPortal(
        <div className="history-import-menu" style={{ top: importMenu.top, left: importMenu.left }} onMouseEnter={() => { if (importMenuTimer.current) window.clearTimeout(importMenuTimer.current); }} onMouseLeave={hideImportMenuSoon}>
          <Link href={importHref(importMenu.item, "img2img")} onClick={() => setImportMenu(null)}>图生图</Link>
          <Link href={importHref(importMenu.item, "generate")} onClick={() => setImportMenu(null)}>文生图</Link>
        </div>,
        document.body,
      )}
    </main>
  );
}
