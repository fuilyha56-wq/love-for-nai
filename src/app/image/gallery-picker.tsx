"use client";

import Image from "next/image";
import { AlertCircle, Check, ImageOff, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import styles from "./gallery-picker.module.css";

/** The public fields returned by GET /api/gallery that the picker uses. */
export type GalleryPickerItem = {
  id: string;
  title: string;
  imageUrl: string;
  rating?: string;
  authorName?: string;
  ownerName?: string;
  tags?: string[];
};

export type GalleryPickerProps = {
  /** Receives the selected image URL, or a data URL when returnDataUrl is enabled. */
  onSelect: (source: string, item: GalleryPickerItem, dataUrl?: string) => void;
  /** Match the selected card from the parent. A gallery URL or returned data URL is accepted. */
  selectedUrl?: string;
  /** Fetch the selected image and return it as a data URL instead of its API URL. */
  returnDataUrl?: boolean;
  /** Override the endpoint for a compatible gallery API, mainly useful for embedding/testing. */
  endpoint?: string;
  heading?: string;
  className?: string;
};

type LoadState = "loading" | "loaded" | "error";

type GalleryResponse = { items?: unknown; message?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseItems(value: unknown): GalleryPickerItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is GalleryPickerItem => (
    isRecord(item) &&
    typeof item.id === "string" &&
    typeof item.imageUrl === "string" &&
    item.imageUrl.length > 0 &&
    typeof item.title === "string"
  )).map((item) => ({
    id: item.id,
    title: item.title,
    imageUrl: item.imageUrl,
    rating: typeof item.rating === "string" ? item.rating : undefined,
    authorName: typeof item.authorName === "string" ? item.authorName : undefined,
    ownerName: typeof item.ownerName === "string" ? item.ownerName : undefined,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
  }));
}

async function readGalleryResponse(response: Response): Promise<GalleryPickerItem[]> {
  let result: GalleryResponse;
  try {
    result = (await response.json()) as GalleryResponse;
  } catch {
    throw new Error("图库返回了无效数据");
  }
  if (!response.ok) {
    throw new Error(typeof result.message === "string" ? result.message : "图库读取失败");
  }
  if (result.items !== undefined && !Array.isArray(result.items)) {
    throw new Error("图库返回了无效数据");
  }
  return parseItems(result.items);
}

async function imageUrlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("图片读取失败，请稍后重试");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("图库返回的不是图片");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

function itemSearchText(item: GalleryPickerItem): string {
  return [item.title, item.authorName, item.ownerName, ...(item.tags || [])]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

export function GalleryPicker({
  onSelect,
  selectedUrl,
  returnDataUrl = false,
  endpoint = "/api/gallery",
  heading = "从公开图库选择",
  className,
}: GalleryPickerProps) {
  const [items, setItems] = useState<GalleryPickerItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectingId, setSelectingId] = useState("");
  const [selectError, setSelectError] = useState("");
  const headingId = useId();

  const loadGallery = useCallback(async (signal?: AbortSignal) => {
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const nextItems = await readGalleryResponse(response);
      if (signal?.aborted) return;
      setItems(nextItems);
      setLoadState("loaded");
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(error instanceof TypeError ? "图库读取失败，请检查网络后重试" : error instanceof Error ? error.message : "图库读取失败，请稍后重试");
      setLoadState("error");
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadGallery(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadGallery]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => itemSearchText(item).includes(normalizedQuery));
  }, [items, query]);

  async function select(item: GalleryPickerItem) {
    setSelectedId(item.id);
    setSelectError("");
    if (!returnDataUrl) {
      onSelect(item.imageUrl, item);
      return;
    }
    setSelectingId(item.id);
    try {
      const dataUrl = await imageUrlToDataUrl(item.imageUrl);
      onSelect(dataUrl, item, dataUrl);
    } catch (error) {
      setSelectError(error instanceof Error ? error.message : "图片读取失败，请稍后重试");
      setSelectedId("");
    } finally {
      setSelectingId("");
    }
  }

  return (
    <section className={`${styles.picker} ${className || ""}`.trim()} aria-labelledby={headingId}>
      <div className={styles.header}>
        <div>
          <h2 id={headingId} className={styles.heading}>{heading}</h2>
          <p className={styles.description}>选择后可将图片导入当前工作台。</p>
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void loadGallery()}
          disabled={loadState === "loading"}
          aria-label="刷新公开图库"
          title="刷新公开图库"
        >
          <RefreshCw size={15} aria-hidden="true" className={loadState === "loading" ? styles.spin : undefined} />
          <span>刷新</span>
        </button>
      </div>

      <label className={styles.search}>
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">搜索公开图库</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、作者或标签"
          aria-label="搜索公开图库"
          spellCheck={false}
        />
      </label>

      {selectError && <p className={styles.alert} role="alert"><AlertCircle size={15} aria-hidden="true" />{selectError}</p>}
      <p className={styles.status} role="status" aria-live="polite">
        {loadState === "loaded" && (query.trim() ? `找到 ${filteredItems.length} 件作品` : `${items.length} 件公开作品`)}
      </p>

      {loadState === "loading" ? (
        <div className={styles.grid} aria-label="正在加载图库" aria-busy="true">
          {Array.from({ length: 8 }, (_, index) => <div className={styles.skeleton} key={index} aria-hidden="true" />)}
        </div>
      ) : loadState === "error" ? (
        <div className={styles.message} role="alert">
          <AlertCircle size={22} aria-hidden="true" />
          <p>{loadError}</p>
          <button type="button" className={styles.retry} onClick={() => void loadGallery()}>
            <RefreshCw size={14} aria-hidden="true" />重试
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className={styles.message}>
          <ImageOff size={24} aria-hidden="true" />
          <p>{query.trim() ? "没有匹配的公开作品" : "公开图库暂无作品"}</p>
          {query.trim() && <button type="button" className={styles.clear} onClick={() => setQuery("")}>清除搜索</button>}
        </div>
      ) : (
        <div className={styles.viewport} tabIndex={0} aria-label="公开图库作品列表">
          <div className={styles.grid} role="list">
            {filteredItems.map((item) => {
              const selected = selectedId === item.id || selectedUrl === item.imageUrl;
              const restricted = item.rating === "r18";
              const selecting = selectingId === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`${styles.card} ${selected ? styles.selected : ""}`.trim()}
                  onClick={() => void select(item)}
                  aria-label={`选择作品：${item.title}${restricted ? "，R18 内容" : ""}`}
                  aria-pressed={selected}
                  disabled={Boolean(selectingId) && !selecting}
                >
                  <span className={styles.media}>
                    <Image
                      src={item.imageUrl}
                      alt=""
                      fill
                      unoptimized
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 180px"
                      className={`${styles.image} ${restricted ? styles.restricted : ""}`.trim()}
                    />
                    {restricted && <span className={styles.badge}>R18</span>}
                    {selecting && <span className={styles.selecting}><Loader2 size={20} aria-label="正在读取图片" className={styles.spin} /></span>}
                    {selected && !selecting && <span className={styles.check}><Check size={15} aria-hidden="true" /></span>}
                  </span>
                  <span className={styles.caption}>
                    <strong>{item.title || "未命名作品"}</strong>
                    <small>{item.authorName || item.ownerName || "匿名"}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export default GalleryPicker;
