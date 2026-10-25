"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ImagePlus, Sparkles, X } from "lucide-react";
import styles from "./gallery-import-dialog.module.css";

/** Shared by the desktop and mobile gallery, including work detail pages. */
export function GalleryImportDialog({ item, onClose }: {
  item: { id: string; title: string };
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const panel = dialog.current;
    panel?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.backdrop} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} className={styles.dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const items = dialog.current?.querySelectorAll<HTMLElement>("button, a[href]");
          const first = items?.[0], last = items?.[items.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <header><h2 id={titleId}>导入到画布</h2><button type="button" aria-label="取消导入" onClick={onClose}><X size={20} /></button></header>
        <p id={descriptionId}>选择「{item.title}」的导入模式</p>
        <nav aria-label="导入模式">
          <Link href={`/image?galleryId=${encodeURIComponent(item.id)}&importMode=generate`} prefetch={false}>
            <Sparkles size={22} aria-hidden="true" /><span><strong>文生图</strong><small>载入已公开的提示词和参数，重新创作</small></span>
          </Link>
          <Link href={`/image?galleryId=${encodeURIComponent(item.id)}&importMode=img2img`} prefetch={false}>
            <ImagePlus size={22} aria-hidden="true" /><span><strong>图生图</strong><small>同时将作品作为源图，基于原图创作</small></span>
          </Link>
        </nav>
      </div>
    </div>, document.body,
  );
}
