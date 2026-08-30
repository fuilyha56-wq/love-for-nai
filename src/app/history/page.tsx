"use client";

import {
  ArrowLeft,
  Check,
  CheckSquare,
  Download,
  History,
  Loader2,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";
import { GallerySubmitDialog, type GallerySubmitForm } from "@/app/gallery-submit";

type HistoryItem = {
  id: string;
  createdAt: string;
  imageUrl: string;
  parameters: Record<string, string | number>;
};

function reuseHref(item: HistoryItem) {
  const params = new URLSearchParams({ reuse: "1" });
  for (const [key, value] of Object.entries(item.parameters))
    params.set(key, String(value));
  return `/image?${params}`;
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

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/history", { cache: "no-store", signal: controller.signal })
      .then((response) =>
        readJson<{ items?: HistoryItem[] }>(response, "读取历史失败"),
      )
      .then((result) => setItems(result.items || []))
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (error instanceof SessionExpiredError) setExpired(error.message);
        else setMessage(error instanceof Error ? error.message : "读取历史失败");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function remove(id: string) {
    if (!window.confirm("确认删除这张历史图片？删除后无法恢复。")) return;
    const response = await fetch(`/api/history?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const result = await response.json();
      setMessage(result.message || "删除失败");
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
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
  async function downloadSelectedZip() {
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
          const response = await fetch(item.imageUrl, { cache: "no-store" });
          if (!response.ok) throw new Error(String(response.status));
          // 原始字节直传，不做任何解码/编码。
          const blob = await response.blob();
          let name = `lfn-${id}.png`;
          let counter = 1;
          while (used.has(name)) name = `lfn-${id}-${counter++}.png`;
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
          : `已打包 ${selected.size} 张无损图片。`,
      );
      exitSelectMode();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "打包失败，请重试");
    } finally {
      setZipping(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa] px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <History size={20} className="text-[var(--rose)]" />
          <b>图片历史</b>
          <span className="text-xs text-[var(--muted)]">最近 10 张</span>
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
                  <CheckSquare size={14} /> 批量下载
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
              <button
                type="button"
                onClick={downloadSelectedZip}
                disabled={!selected.size || zipping}
                className="flex h-8 items-center gap-1.5 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                {zipping ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> 打包中…
                  </>
                ) : (
                  <>
                    <Download size={14} /> 下载 ZIP（{selected.size}）
                  </>
                )}
              </button>
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <article
                key={item.id}
                className="overflow-hidden rounded-md border border-[var(--line)] bg-white"
              >
                <div
                  className={`relative aspect-[4/5] bg-[#ebe9e2] ${
                    selectMode ? "cursor-pointer" : ""
                  }`}
                  onClick={
                    selectMode
                      ? () => toggleSelect(item.id)
                      : undefined
                  }
                >
                  <Image
                    src={item.imageUrl}
                    alt="历史生成图片"
                    fill
                    unoptimized
                    className={`object-contain ${selectMode && selected.has(item.id) ? "opacity-60" : ""}`}
                  />
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
                <div className="p-3">
                  <p className="line-clamp-2 min-h-10 text-xs leading-5">
                    {item.parameters.prompt || "未记录提示词"}
                  </p>
                  <div className="mt-2 flex justify-between text-[10px] text-[var(--muted)]">
                    <span>{item.parameters.model || "未知模型"}</span>
                    <time>
                      {new Date(item.createdAt).toLocaleString("zh-CN")}
                    </time>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    <Link
                      href={reuseHref(item)}
                      className="history-action"
                      title="复用参数"
                    >
                      <RotateCcw size={15} />
                    </Link>
                    <a
                      href={item.imageUrl}
                      download={`lfn-${item.id}.png`}
                      className="history-action"
                      title="下载图片"
                    >
                      <Download size={15} />
                    </a>
                    <button
                      type="button"
                      onClick={() => setGalleryForm({ historyId: item.id, title: item.parameters.prompt?.toString().slice(0, 40) || "未命名作品", authorName: "", rating: "general", source: "lfn", tags: "", exposeParameters: true })}
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
          onPublished={() => setMessage("作品已发布到图片广场。")}
          onSessionExpired={(sessionMessage) => setExpired(sessionMessage)}
        />
      )}
    </main>
  );
}
