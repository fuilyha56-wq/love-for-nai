"use client";

import Image from "@/app/cached-image";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, History, Images, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import { useGalleryHistory, type GalleryHistoryImage } from "./use-gallery-history";
import styles from "./gallery-history-field.module.css";

const PAGE_SIZE = 12;
const dateLabel = (value: number) => value ? new Date(value).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "时间未记录";

export function GalleryHistoryField({ historyId, file, title, disabled, onSelect, onClear }: {
  historyId?: string;
  file?: File;
  title: string;
  disabled: boolean;
  onSelect: (image: GalleryHistoryImage) => void;
  onClear: () => void;
}) {
  const searchId = useId();
  const [browsing, setBrowsing] = useState(!historyId && !file);
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<"all" | "account" | "local">("all");
  const [page, setPage] = useState(1);
  const [candidate, setCandidate] = useState("");
  const [filePreview, setFilePreview] = useState("");
  const [selectedLocalKey, setSelectedLocalKey] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const selectionVersion = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const history = useGalleryHistory(() => { selectionVersion.current += 1; setSelecting(false); setSelectedLocalKey(""); onClear(); setCandidate(""); setBrowsing(true); });
  useEffect(() => () => { selectionVersion.current += 1; }, [history.identityRevision]);
  useEffect(() => { if (gridRef.current) gridRef.current.scrollTop = 0; }, [page, query, origin]);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // The URL belongs to the committed file lifecycle and must be revoked on cleanup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const selected = history.items.find(item => historyId ? item.historyId === historyId : file && item.key === selectedLocalKey);
  const missingSelection = Boolean(historyId && !history.loading && !history.error && !selected);
  const showBrowser = browsing || (!historyId && !file) || missingSelection;
  const preview = selected?.thumbnail || (historyId ? `/api/history/${encodeURIComponent(historyId)}/image?variant=thumbnail` : file ? filePreview : "");
  const filtered = history.items.filter(item => (origin === "all" || item.origin === origin) && `${item.prompt} ${item.model} ${dateLabel(item.createdAt)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const chosen = history.items.find(item => item.key === candidate);
  async function selectChosen() {
    if (!chosen) return;
    const version = ++selectionVersion.current;
    setSelecting(true); setSelectionError("");
    try {
      const image = await history.resolveSelection(chosen);
      if (version !== selectionVersion.current) return;
      setSelectedLocalKey(image.localId ? image.key : "");
      onSelect(image); setBrowsing(false);
    } catch (error) {
      if (version === selectionVersion.current) setSelectionError(error instanceof Error ? error.message : "原图读取失败，请重新选择。");
    } finally { if (version === selectionVersion.current) setSelecting(false); }
  }

  return <fieldset className={styles.field} disabled={disabled || selecting} aria-busy={selecting} aria-label="从图片历史选择投稿原图">
    <div className={styles.heading}><span><History size={17} /><b>图片历史</b></span>{(historyId || file) && <button type="button" onClick={() => { setBrowsing(!showBrowser); setCandidate(selected?.key || ""); }}>{showBrowser ? "收起列表" : "更换图片"}</button>}</div>
    {!showBrowser && preview && <div className={styles.selection}>
      <Image unoptimized src={preview} width={144} height={180} alt="已选投稿历史图片" />
      <div><b>{selected?.prompt || title || file?.name || "已选历史图片"}</b><small>{selected ? `${selected.model} · ${selected.width} × ${selected.height}` : historyId ? "账号历史原图" : "本机历史原图"}</small>{selected && <small>{dateLabel(selected.createdAt)}</small>}<span className={styles.selectedBadge}><Check size={12} />已选择 1 张</span></div>
      <button type="button" aria-label="移除已选历史图片" onClick={() => { onClear(); setCandidate(""); setBrowsing(true); }}><X size={16} /></button>
    </div>}
    {showBrowser && <div className={styles.browser}>
      {missingSelection && <p role="alert" className={styles.hint}>之前选择的图片已不在当前账号的历史列表中，请重新选择。</p>}
      <p className={styles.hint}>选择一张历史原图用于本次投稿；选定后可继续编辑作品信息。</p>
      <div className={styles.sources} role="group" aria-label="筛选历史图片来源">{(["all", "account", "local"] as const).map(value => <button type="button" key={value} aria-pressed={origin === value} onClick={() => { setOrigin(value); setPage(1); setCandidate(""); }}>{value === "all" ? "全部" : value === "account" ? "账号历史" : "本机历史"}</button>)}</div>
      <div className={styles.searchRow}><label className={styles.search} htmlFor={searchId}><Search size={16} /><input id={searchId} aria-label="搜索历史图片" value={query} placeholder="搜索提示词、模型或日期" onChange={event => { setQuery(event.target.value); setPage(1); setCandidate(""); }} />{query && <button type="button" aria-label="清空历史图片搜索" onClick={() => { setQuery(""); setPage(1); setCandidate(""); }}><X size={14} /></button>}</label><button className={styles.refresh} type="button" disabled={history.loading} aria-label="刷新可投稿的历史图片" onClick={() => { setPage(1); setCandidate(""); history.refresh(); }}><RefreshCw size={16} className={history.loading ? styles.spin : ""} /></button></div>
      {history.warning && <p role="status" className={styles.hint}>{history.warning}</p>}
      {history.loading ? <div className={styles.empty} role="status"><LoaderCircle className={styles.spin} size={24} /><b>正在读取历史图片</b></div> : history.error ? <div className={styles.empty} role="alert"><Images size={26} /><b>{history.error}</b><button type="button" onClick={history.refresh}>重新加载</button></div> : !filtered.length ? <div className={styles.empty}><Images size={26} /><b>{query.trim() ? "没有匹配的历史图片" : "暂无可选择的历史图片"}</b><span>{query.trim() ? "试试其他关键词。" : "此处显示当前账号保存的历史，以及该账号的本机 PNG / JPEG 历史。"}</span>{query.trim() && <button type="button" onClick={() => { setQuery(""); setPage(1); setCandidate(""); }}>清空搜索</button>}</div> : <>
        <div className={styles.resultCount} role="status">共 {filtered.length} 张 · 单次选择 1 张</div>
        <div ref={gridRef} className={styles.grid}>{filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(item => <button className={styles.card} type="button" key={item.key} aria-pressed={candidate === item.key} aria-label={`选择历史图片：${item.prompt || "未记录提示词"}`} onClick={() => { setCandidate(item.key); setSelectionError(""); }}>
          <span className={styles.frame}><Image unoptimized src={item.thumbnail} width={320} height={400} alt="历史生成图片" /><span className={styles.check} aria-hidden="true">{candidate === item.key && <Check size={14} />}</span><span className={styles.origin}>{item.origin === "account" ? "账号" : "本机"}</span></span>
          <span className={styles.cardCopy}><b>{item.prompt || "未记录提示词"}</b><small>{item.model}</small><span><small>{item.width} × {item.height}</small><time dateTime={item.createdAt ? new Date(item.createdAt).toISOString() : undefined}>{dateLabel(item.createdAt)}</time></span></span>
        </button>)}</div>
        <div className={styles.pagination}><button type="button" aria-label="上一页历史图片" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>第 {currentPage} / {pages} 页</span><button type="button" aria-label="下一页历史图片" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div>
      </>}
      {selectionError && <p className={styles.hint} role="alert">{selectionError}</p>}
      <div className={styles.actions}><span>{chosen ? "已选 1 张历史原图" : "尚未选择图片"}</span><button type="button" disabled={!chosen || history.loading || selecting} onClick={() => void selectChosen()}> {selecting ? <LoaderCircle className={styles.spin} size={15} /> : <Check size={15} />}{selecting ? "正在读取原图…" : "使用选中图片"}</button></div>
    </div>}
  </fieldset>;
}
