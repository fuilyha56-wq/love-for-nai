"use client";

import { AlertTriangle, ArrowLeft, ChevronRight, RefreshCw, SearchX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MarkdownView } from "@/mobile/markdown";
import { PublicHeader } from "@/mobile/public-header";
import { PopupSelect } from "@/mobile/ui/popup-select";
import { DocsFilters, documentBody } from "@/app/docs/docs-filters";
import styles from "@/app/ui/discovery-controls.module.css";
import "./docs.css";

type PublicDocument = {
  slug: string;
  title: string;
  category: string;
  summary: string;
  content: string;
  status: "published";
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export default function DocsPage() {
  const [items, setItems] = useState<PublicDocument[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/docs", { cache: "no-store" });
      const result = (await response.json()) as { items?: PublicDocument[]; message?: string };
      if (!response.ok) throw new Error(result.message || "文档读取失败");
      const nextItems = Array.isArray(result.items) ? result.items : [];
      const requestedSlug = new URLSearchParams(window.location.search).get("slug");
      const requestedQuery = new URLSearchParams(window.location.search).get("q") || "";
      setItems(nextItems);
      setQuery((current) => current || requestedQuery);
      if (requestedSlug) setDetail(true);
      setSelectedSlug((current) => current && nextItems.some((item) => item.slug === current)
        ? current
        : requestedSlug && nextItems.some((item) => item.slug === requestedSlug)
          ? requestedSlug
          : nextItems[0]?.slug || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文档读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);
  useEffect(() => {
    const restore = () => {
      if (window.location.pathname !== "/docs") return;
      const slug = new URLSearchParams(window.location.search).get("slug");
      setDetail(Boolean(slug));
      if (slug) setSelectedSlug(slug);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const categories = [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems = items.filter((item) =>
    (category === "all" || item.category === category) &&
    (!normalizedQuery || [item.title, item.category, item.summary, item.content].join(" ").toLocaleLowerCase().includes(normalizedQuery)),
  );
  const selected = visibleItems.find((item) => item.slug === selectedSlug) || visibleItems[0];
  function resetFilters() { setQuery(""); setCategory("all"); }
  function select(slug: string | null) {
    if (!slug && window.history.state?.lfnDocsDetail) { window.history.back(); return; }
    if (slug) setSelectedSlug(slug);
    setDetail(Boolean(slug));
    const params = new URLSearchParams(window.location.search);
    if (slug) params.set("slug", slug); else params.delete("slug");
    const href = `/docs${params.size ? `?${params}` : ""}`;
    const state = { ...window.history.state, lfnDocsDetail: Boolean(slug) };
    if (slug && !detail) window.history.pushState(state, "", href);
    else window.history.replaceState(state, "", href);
    window.scrollTo({ top: 0 });
  }
  return <main className={`launcher-docs workspace-page ${styles.page}`} data-doc-detail={detail}>
    <PublicHeader current="docs" extraActions={detail && <button type="button" className="docs-back" onClick={() => select(null)}><ArrowLeft size={18} />返回目录</button>} />
    <section className="docs-content">
      {!detail && <div className={styles.intro}><div><p>使用指南、模型说明与 API 参数参考。</p></div></div>}
      {error && <div className="docs-error" role="alert"><span><AlertTriangle size={18} />{error}</span><button type="button" onClick={() => void load()}><RefreshCw size={16} />重试</button></div>}
      {!loading && items.length > 0 && !detail && <div className="mb-4"><DocsFilters Select={PopupSelect} query={query} onQueryChange={setQuery} category={category} onCategoryChange={setCategory} categories={categories.map((item) => ({ value: item, label: item, description: `${items.filter((doc) => doc.category === item).length} 篇文档` }))} count={visibleItems.length} total={items.length} onReset={resetFilters} /></div>}
      {loading ? <p className="docs-empty" role="status">正在加载文档…</p> : !items.length ? <p className="docs-empty">暂无已发布文档</p> : <div className="docs-layout">
        {!visibleItems.length ? <div className={styles.empty}><SearchX size={28} aria-hidden="true" /><h2>没有找到相关文档</h2><p>试试其他关键词，或调整文档分类。</p><button type="button" className="lfn-button" onClick={resetFilters}>清空筛选，查看全部文档</button></div> : <><aside className="docs-directory"><h2>文档目录</h2><nav aria-label="文档目录">{visibleItems.map(item => <button type="button" key={item.slug} aria-current={selected?.slug === item.slug ? "page" : undefined} onClick={() => select(item.slug)}><span><small>{item.category}</small><b>{item.title}</b><small className="docs-summary">{item.summary}</small></span><ChevronRight size={18} /></button>)}</nav></aside>
        {selected && <article className="docs-article" aria-label={selected.title}><header><p>{selected.category}</p><h2>{selected.title}</h2><p>{selected.summary}</p></header><MarkdownView content={documentBody(selected.content, selected.title)} /><footer>最后更新：{new Date(selected.updatedAt).toLocaleString("zh-CN")}</footer></article>}
        </>}
      </div>}
    </section>
  </main>;
}
