"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "./use-dialog-focus";
import "./adaptive-dialog.css";

const scrollLocks = new Set<symbol>();
let unlockedOverflow = "";

/** Aaalice adaptive modal: centered on large screens and a sheet on phones. */
export function AdaptiveDialog({ children, onClose, label, labelledBy, wide = false, className = "" }: {
  children: ReactNode; onClose: () => void; label?: string; labelledBy?: string; wide?: boolean; className?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialog);
  useEffect(() => {
    const lock = Symbol();
    if (!scrollLocks.size) unlockedOverflow = document.body.style.overflow;
    scrollLocks.add(lock);
    document.body.style.overflow = "hidden";
    return () => {
      scrollLocks.delete(lock);
      if (!scrollLocks.size) document.body.style.overflow = unlockedOverflow;
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<div className="lfn-adaptive-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); } }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} className={`lfn-adaptive-dialog ${wide ? "is-wide" : ""} ${className}`}>{children}</div>
  </div>, document.body);
}
