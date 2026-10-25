"use client";

import { useCallback, useEffect, useState } from "react";

export type GallerySort = "newest" | "likes" | "downloads" | "uses";
export type GalleryItem = {
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

const PAGE_SIZE = 24;

export function useGalleryDiscovery() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [rating, setRating] = useState("all");
  const [sort, setSort] = useState<GallerySort>("newest");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: debouncedQuery,
      rating,
      sort,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    const tags = tagFilter.split(/[\n,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 10);
    for (const tag of tags) params.append("tag", tag);

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
  }, [debouncedQuery, tagFilter, rating, sort, page, refreshKey]);

  const prepareLoad = useCallback(() => { setLoadState("loading"); setError(""); }, []);
  const refresh = useCallback(() => { prepareLoad(); setRefreshKey((value) => value + 1); }, [prepareLoad]);
  const updateQuery = useCallback((value: string) => { prepareLoad(); setQuery(value); setPage(1); }, [prepareLoad]);
  const updateTagFilter = useCallback((value: string) => { prepareLoad(); setTagFilter(value); setPage(1); }, [prepareLoad]);
  const updateRating = useCallback((value: string) => { prepareLoad(); setRating(value); setPage(1); }, [prepareLoad]);
  const updateSort = useCallback((value: GallerySort) => { prepareLoad(); setSort(value); setPage(1); }, [prepareLoad]);
  const updatePage = useCallback((value: number) => { prepareLoad(); setPage(value); }, [prepareLoad]);
  const resetFilters = useCallback(() => {
    prepareLoad();
    setQuery("");
    setDebouncedQuery("");
    setTagFilter("");
    setRating("all");
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
    setRating: updateRating,
    sort,
    setSort: updateSort,
    page,
    setPage: updatePage,
    pageCount,
    total,
    tagSuggestions,
    refresh,
    resetFilters,
  };
}
