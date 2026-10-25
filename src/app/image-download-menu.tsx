"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Download } from "lucide-react";
import { fetchCachedImageBlob } from "@/lib/browser-image-cache";

type ImageDownloadMenuProps = {
  src?: string;
  getImage?: () => Promise<Blob>;
  filename: string;
  className?: string;
  label?: string;
  title?: string;
  disabled?: boolean;
  onDownloaded?: () => void;
};

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 120) || "lfn-image";
}

function extensionFor(blob: Blob): string {
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/webp") return "webp";
  return "png";
}

export function ImageDownloadMenu({ src, getImage, filename, className, label, title, disabled = false, onDownloaded }: ImageDownloadMenuProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDetailsElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (rootRef.current) rootRef.current.open = false;
    if (restoreFocus) rootRef.current?.querySelector("summary")?.focus({ preventScroll: true });
  }, []);

  const positionMenu = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect();
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const left = viewport?.offsetLeft || 0;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const menuWidth = Math.min(210, width - 16);
    const desiredHeight = menu.scrollHeight;
    const below = Math.max(0, top + height - trigger.bottom - 14);
    const above = Math.max(0, trigger.top - top - 14);
    const openAbove = below < desiredHeight && above > below;
    const available = openAbove ? above : below;
    const menuHeight = Math.min(desiredHeight, available);
    setMenuStyle({
      position: "fixed", visibility: "visible", width: menuWidth, minWidth: 0,
      left: Math.max(left + 8, Math.min(trigger.right - menuWidth, left + width - menuWidth - 8)),
      top: openAbove ? Math.max(top + 8, trigger.top - menuHeight - 6) : Math.min(trigger.bottom + 6, top + height - menuHeight - 8),
      right: "auto", maxHeight: available, overflowY: "auto",
      transformOrigin: openAbove ? "bottom right" : "top right",
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    // A native dialog is itself in the browser's top layer. Its download menu
    // must join that layer as a descendant, rather than sitting behind it on body.
    if (menu && typeof menu.showPopover === "function" && !menu.matches(":popover-open")) menu.showPopover();
    positionMenu();
  }, [open, busy, error, positionMenu]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); close(true); }
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      positionMenu();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", positionMenu);
    window.visualViewport?.addEventListener("scroll", positionMenu);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(positionMenu);
    if (rootRef.current) observer?.observe(rootRef.current);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", positionMenu);
      window.visualViewport?.removeEventListener("scroll", positionMenu);
      observer?.disconnect();
    };
  }, [open, close, positionMenu]);

  async function download(cleanMetadata: boolean) {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      let blob: Blob;
      if (getImage) blob = await getImage();
      else {
        if (!src) throw new Error("缺少图片来源");
        blob = await fetchCachedImageBlob(src);
      }
      if (!blob.type.startsWith("image/")) throw new Error("来源不是图片文件");
      if (cleanMetadata) {
        const response = await fetch("/api/images/metadata-strip", {
          method: "POST",
          headers: { "Content-Type": blob.type },
          body: blob,
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(result?.message || "清理 NAI 图片数据失败");
        }
        blob = await response.blob();
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFilename(filename)}.${extensionFor(blob)}`;
      anchor.click();
      try { onDownloaded?.(); } catch { /* Analytics must not block a completed download. */ }
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "下载失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={`image-download-menu ${className || ""}`.trim()} ref={rootRef} onToggle={(event) => {
      const nextOpen = event.currentTarget.open && !disabled;
      if (nextOpen) setPortalTarget(event.currentTarget.closest("dialog") || document.body);
      setOpen(nextOpen);
    }}>
      <summary aria-label={title || "下载图片"} title={title || "下载图片"} aria-disabled={disabled || undefined} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
        onClick={(event) => { if (disabled) event.preventDefault(); }}>
        <Download size={15} />
        {label && <span>{label}</span>}
      </summary>
      {open && portalTarget && createPortal(<div className="image-download-menu-popover" role="menu" popover="manual" id={menuId} ref={menuRef} style={menuStyle} aria-label="图片下载方式"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') || [])];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        }}>
        <button type="button" role="menuitem" disabled={busy} onClick={() => void download(false)}>
          下载原图
        </button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => void download(true)}>
          抹除 NAI 数据后下载
        </button>
        {busy && <small role="status">正在处理图片…</small>}
        {error && <small role="alert">{error}</small>}
      </div>, portalTarget)}
    </details>
  );
}
