"use client";

import { LoaderCircle, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useId } from "react";
import { LfnSearchField } from "@/app/ui/lfn-search-field";
import { PopupSelect } from "@/app/ui/popup-select";
import styles from "@/app/ui/discovery-controls.module.css";
import layout from "./gallery-filters.module.css";
import type { GallerySort } from "./use-gallery-discovery";

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
const categories = [
  { value: "all", label: "全部图片" },
  { value: "no-original-data", label: "无原数据图" },
];

export function GalleryFilters({ query, onQueryChange, tagFilter, onTagFilterChange, tagSuggestions, rating, onRatingChange, category = "all", onCategoryChange, sort, onSortChange, total, loading, onReset, onRefresh, Select = PopupSelect }: {
  category?: string;
  onCategoryChange?: (value: string) => void;
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
  const filtered = Boolean(query || tags.length || rating !== "all" || category !== "all" || sort !== "newest");
  const filters = [
    { key: "category", label: "原数据分类", ariaLabel: "按原数据分类筛选", value: category, options: categories, onChange: (value: string) => onCategoryChange?.(value) },
    { key: "rating", label: "作品分级", ariaLabel: "按作品分级筛选", value: rating, options: ratings, onChange: onRatingChange },
    { key: "sort", label: "排序方式", ariaLabel: "图库排序方式", value: sort, options: sorts, onChange: (value: string) => onSortChange(value as GallerySort) },
  ];
  return <section className={styles.panel} aria-label="图片广场搜索与筛选">
    <div className={layout.searchFields}>
      <LfnSearchField label="搜索图片广场" value={query} onChange={onQueryChange} placeholder="搜索作品名、作者或标签…" />
      <LfnSearchField label="按标签筛选作品" value={tagFilter} onChange={onTagFilterChange} placeholder="输入标签，多个标签用逗号分隔" suggestions={tagSuggestions} multiple />
    </div>
    <div className={layout.filterFields}>
      {filters.map(filter => <div key={filter.key} className={`${styles.field} ${styles.select}`}>
        <label className={styles.label} htmlFor={`${id}-${filter.key}`}>{filter.label}</label>
        <Select id={`${id}-${filter.key}`} ariaLabel={filter.ariaLabel} value={filter.value} options={filter.options} onChange={filter.onChange} menuClassName={styles.menu} />
      </div>)}
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
