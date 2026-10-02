"use client";

import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, type ReactElement } from "react";

const VIEWPORT_GUTTER = 8;

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      const bounds = anchor?.firstElementChild?.getBoundingClientRect() ?? anchor?.getBoundingClientRect();
      if (!bounds || !tooltip) return;
      const tooltipBounds = tooltip.getBoundingClientRect();
      const left = Math.max(
        VIEWPORT_GUTTER,
        Math.min(
          bounds.left + (bounds.width - tooltipBounds.width) / 2,
          window.innerWidth - tooltipBounds.width - VIEWPORT_GUTTER,
        ),
      );
      const above = bounds.top - tooltipBounds.height - 6;
      const below = bounds.bottom + 6;
      setPosition({
        top: above >= VIEWPORT_GUTTER ? above : Math.min(below, window.innerHeight - tooltipBounds.height - VIEWPORT_GUTTER),
        left,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <span
      ref={anchorRef}
      className="lfn-tooltip-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && createPortal(
        <span
          ref={tooltipRef}
          data-lfn-tooltip
          role="tooltip"
          className="lfn-tooltip"
          style={{
            top: position?.top,
            left: position?.left,
            visibility: position ? "visible" : "hidden",
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  );
}
