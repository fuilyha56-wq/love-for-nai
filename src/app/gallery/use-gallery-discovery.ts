"use client";

import { useCallback, useEffect, useState } from "react";
import { galleryDetailHref, GALLERY_POSITION_KEY, galleryPosition } from "@/lib/gallery-navigation";

import { useGalleryScrollRestoration } from "./use-gallery-navigation";

export type GallerySort = "newest" | "likes" | "downloads" | "uses";
export type GalleryItem = {
  noOriginalData?: boolean;
  promptMode?: string;
  upscaled?: boolean;
  originalFileName?: string;
  id: string;
  title: string;
  ownerName: string;
  authorName?: string;
  rating: string;
  source: string;
  tags: string[];
  parameters: Record<string, unknown>;
  imageUrl: string;
  thumbnailUrl?: string;
  likes: number;
  downloads?: number;
  uses?: number;
};
type LoadState = "loading" | "loaded" | "error";
type GalleryResponse = {
  items?: GalleryItem[];
  tags?: string[];
  total?: number;
  page?: number;
  pageCount?: number;
  message?: string;
};

const PAGE_SIZE = 100;

export function useGalleryDiscovery() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [rating, setRating] = useState("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<GallerySort>("newest");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [ready, setReady] = useState(false);
  const rememberPosition = useGalleryScrollRestoration(loadState === "loaded");

  useEffect(() => {
    void Promise.resolve().then(() => {
      let url = new URL(window.location.href);
      try {
        const saved = galleryPosition(JSON.parse(sessionStorage.getItem(GALLERY_POSITION_KEY) || "null"), Date.now());
        if (saved && (url.searchParams.has("restore") || url.pathname + url.search === saved.href)) {
          if (url.searchParams.has("restore")) url = new URL(saved.href, url.origin);
        }
      } catch { /* URL state still works when browser storage is unavailable. */ }
      const params = url.searchParams;
      setQuery(params.get("q") || ""); setDebouncedQuery((params.get("q") || "").trim());
      setTagFilter(params.getAll("tag").join(", "));
      setCategory(params.get("category") === "no-original-data" ? "no-original-data" : "all");
      setRating(["general", "r13", "r17", "r18"].includes(params.get("rating") || "") ? params.get("rating")! : "all");
      setSort(["likes", "downloads", "uses"].includes(params.get("sort") || "") ? params.get("sort") as GallerySort : "newest");
      setPage(Math.max(1, Math.floor(Number(params.get("page")) || 1)));
      setReady(true);
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: debouncedQuery,
      rating,
      category,
      sort,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    const tags = tagFilter.split(/[\n,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 10);
    for (const tag of tags) params.append("tag", tag);
    const locationParams = new URLSearchParams(params);
    locationParams.delete("pageSize");
    if (!debouncedQuery) locationParams.delete("q");
    if (rating === "all") locationParams.delete("rating");
    if (category === "all") locationParams.delete("category");
    if (sort === "newest") locationParams.delete("sort");
    if (page === 1) locationParams.delete("page");
    const search = locationParams.toString();
    window.history.replaceState(window.history.state, "", `/gallery${search ? `?${search}` : ""}`);

    void fetch(`/api/gallery?${params.toString()}`, {
      cache: refreshKey ? "reload" : "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as GalleryResponse;
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(result.message || "图库读取失败");
        setItems(Array.isArray(result.items) ? result.items : []);
        setTagSuggestions(Array.isArray(result.tags) ? result.tags : []);
        setTotal(Number.isSafeInteger(result.total) ? Number(result.total) : 0);
        setPageCount(Number.isSafeInteger(result.pageCount) ? Math.max(1, Number(result.pageCount)) : 1);
        if (Number.isSafeInteger(result.page) && result.page !== page) setPage(Number(result.page));
        setLoadState("loaded");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof TypeError ? "图库读取失败，请检查网络后重试" : reason instanceof Error ? reason.message : "图库读取失败，请稍后重试");
        setLoadState("error");
      });
    return () => controller.abort();
  }, [debouncedQuery, tagFilter, rating, category, sort, page, refreshKey, ready]);

  const prepareLoad = useCallback(() => { setLoadState("loading"); setError(""); }, []);
  const refresh = useCallback(() => { prepareLoad(); setRefreshKey((value) => value + 1); }, [prepareLoad]);
  const updateQuery = useCallback((value: string) => { prepareLoad(); setQuery(value); setPage(1); }, [prepareLoad]);
  const updateTagFilter = useCallback((value: string) => { prepareLoad(); setTagFilter(value); setPage(1); }, [prepareLoad]);
  const updateRating = useCallback((value: string) => { prepareLoad(); setRating(value); setPage(1); }, [prepareLoad]);
  const updateCategory = useCallback((value: string) => { prepareLoad(); setCategory(value); setPage(1); }, [prepareLoad]);
  const updateSort = useCallback((value: GallerySort) => { prepareLoad(); setSort(value); setPage(1); }, [prepareLoad]);
  const updatePage = useCallback((value: number) => { prepareLoad(); setPage(value); window.scrollTo({ top: 0, behavior: "instant" }); }, [prepareLoad]);
  const resetFilters = useCallback(() => {
    prepareLoad();
    setQuery("");
    setDebouncedQuery("");
    setTagFilter("");
    setRating("all");
    setCategory("all");
    setSort("newest");
    setPage(1);
    setRefreshKey((value) => value + 1);
  }, [prepareLoad]);

  return {
    items,
    setItems,
    loadState,
    error,
    query,
    setQuery: updateQuery,
    tagFilter,
    setTagFilter: updateTagFilter,
    rating,
    category,
    setCategory: updateCategory,
    setRating: updateRating,
    sort,
    setSort: updateSort,
    page,
    setPage: updatePage,
    pageCount,
    total,
    tagSuggestions,
    refresh,
    rememberPosition,
    detailHref: (id: string) => galleryDetailHref(id, typeof window === "undefined" ? "/gallery" : window.location.pathname + window.location.search),
    resetFilters,
  };
}
