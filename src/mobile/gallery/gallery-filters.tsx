"use client";

import { LoaderCircle, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useId } from "react";
import { LfnSearchField } from "@/app/ui/lfn-search-field";
import { PopupSelect } from "@/mobile/ui/popup-select";
import styles from "@/mobile/ui/discovery-controls.module.css";
import type { GallerySort } from "@/app/gallery/use-gallery-discovery";

const ratings = [
  { value: "all", label: "全部分级" },
  { value: "general", label: "全年龄" },
  { value: "r13", label: "R13" },
  { value: "r17", label: "R17" },
  { value: "r18", label: "R18" },
];
const sorts = [
  { value: "newest", label: "最新发布" },
  { value: "likes", label: "点赞最多" },
  { value: "downloads", label: "下载最多" },
  { value: "uses", label: "导入使用最多" },
];

export function GalleryFilters({ query, onQueryChange, tagFilter, onTagFilterChange, tagSuggestions, rating, onRatingChange, sort, onSortChange, total, loading, onReset, onRefresh, Select = PopupSelect }: {
  query: string;
  onQueryChange: (value: string) => void;
  tagFilter: string;
  onTagFilterChange: (value: string) => void;
  tagSuggestions: string[];
  rating: string;
  onRatingChange: (value: string) => void;
  sort: GallerySort;
  onSortChange: (value: GallerySort) => void;
  total: number;
  loading: boolean;
  onReset: () => void;
  onRefresh: () => void;
  Select?: typeof PopupSelect;
}) {
  const id = useId();
  const tags = [...new Set(tagFilter.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean))];
  const filtered = Boolean(query || tags.length || rating !== "all" || sort !== "newest");
  return <section className={styles.panel} aria-label="图片广场搜索与筛选">
    <LfnSearchField label="搜索图片广场" value={query} onChange={onQueryChange} placeholder="搜索作品名、作者或标签…" />
    <div className={styles.filters}>
      <LfnSearchField label="按标签筛选作品" value={tagFilter} onChange={onTagFilterChange} placeholder="输入标签，多个标签用逗号分隔" suggestions={tagSuggestions} multiple />
      <div className={`${styles.field} ${styles.select}`}>
        <label className={styles.label} htmlFor={`${id}-rating`}>作品分级</label>
        <Select id={`${id}-rating`} ariaLabel="按作品分级筛选" value={rating} options={ratings} onChange={onRatingChange} menuClassName={styles.menu} />
      </div>
      <div className={`${styles.field} ${styles.select}`}>
        <label className={styles.label} htmlFor={`${id}-sort`}>排序方式</label>
        <Select id={`${id}-sort`} ariaLabel="图库排序方式" value={sort} options={sorts} onChange={(value) => onSortChange(value as GallerySort)} menuClassName={styles.menu} />
      </div>
    </div>
    <div className={styles.footer}>
      <p className={styles.status} role="status" aria-live="polite">{loading ? <><LoaderCircle size={14} className={styles.spin} aria-hidden="true" />正在查找作品…</> : <><SlidersHorizontal size={14} aria-hidden="true" />{filtered ? "找到" : "共"} <strong>{total}</strong> 件作品</>}</p>
      <div className={styles.actions}>{filtered && <button type="button" className={styles.reset} onClick={onReset}><X size={13} aria-hidden="true" />重置筛选</button>}<button type="button" className={styles.reset} onClick={onRefresh} disabled={loading} aria-label="刷新图片广场"><RotateCcw size={13} aria-hidden="true" />刷新</button></div>
    </div>
    {(query || tags.length > 0 || rating !== "all") && <div className={styles.chips} aria-label="已选筛选条件">
      {query && <button type="button" className={styles.chip} onClick={() => onQueryChange("")} aria-label={`移除搜索：${query}`}><span>搜索：{query}</span><X size={12} aria-hidden="true" /></button>}
      {tags.map((tag) => <button type="button" key={tag} className={styles.chip} onClick={() => onTagFilterChange(tags.filter((item) => item !== tag).join(", "))} aria-label={`移除标签：${tag}`}><span>#{tag}</span><X size={12} aria-hidden="true" /></button>)}
      {rating !== "all" && <button type="button" className={styles.chip} onClick={() => onRatingChange("all")} aria-label="移除分级筛选"><span>{ratings.find((item) => item.value === rating)?.label}</span><X size={12} aria-hidden="true" /></button>}
    </div>}
  </section>;
}
