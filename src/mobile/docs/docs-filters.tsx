"use client";

import { BookOpen, RotateCcw, X } from "lucide-react";
import { useId } from "react";
import { LfnSearchField } from "@/app/ui/lfn-search-field";
import { PopupSelect } from "@/mobile/ui/popup-select";
import styles from "@/mobile/ui/discovery-controls.module.css";

/** The article header already displays the title. Keep a distinct Markdown heading. */
export function documentBody(content: string, title: string): string {
  const normalized = content.replaceAll("\r\n", "\n");
  const heading = `# ${title}\n`;
  return normalized.startsWith(heading) ? normalized.slice(heading.length).trimStart() : content;
}

export function DocsFilters({ query, onQueryChange, category, onCategoryChange, categories, count, total, onReset, Select = PopupSelect }: {
  query: string;
  onQueryChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  categories: { value: string; label: string; description?: string }[];
  count: number;
  total: number;
  onReset: () => void;
  Select?: typeof PopupSelect;
}) {
  const id = useId();
  const filtered = Boolean(query || category !== "all");
  return <section className={styles.panel} aria-label="文档搜索与筛选">
    <div className={styles.searchRow}>
      <LfnSearchField label="搜索全部文档内容" value={query} onChange={onQueryChange} placeholder="搜索标题、正文、端点或参数…" />
      <div className={`${styles.field} ${styles.select}`}>
        <label htmlFor={id} className={styles.label}>文档分类</label>
        <Select id={id} ariaLabel="文档分类" value={category} onChange={onCategoryChange} options={[{ value: "all", label: "全部分类", description: `${total} 篇文档` }, ...categories]} menuClassName={styles.menu} />
      </div>
    </div>
    <div className={styles.footer}>
      <p className={styles.status} role="status" aria-live="polite"><BookOpen size={14} aria-hidden="true" />{filtered ? "找到" : "共"} <strong>{count}</strong> 篇文档{query && " · 已搜索全部正文"}</p>
      {filtered && <button className={styles.reset} type="button" onClick={onReset}><RotateCcw size={13} aria-hidden="true" />重置筛选</button>}
    </div>
    {filtered && <div className={styles.chips} aria-label="已选文档筛选条件">
      {query && <button className={styles.chip} type="button" onClick={() => onQueryChange("")} aria-label={`移除搜索：${query}`}><span>搜索：{query}</span><X size={12} aria-hidden="true" /></button>}
      {category !== "all" && <button className={styles.chip} type="button" onClick={() => onCategoryChange("all")} aria-label="移除文档分类筛选"><span>{category}</span><X size={12} aria-hidden="true" /></button>}
    </div>}
  </section>;
}
