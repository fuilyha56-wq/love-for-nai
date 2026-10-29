"use client";

import { useEffect } from "react";

/** The visual viewport shrinks for mobile keyboards even when 100dvh does not. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let frame = 0;
    function measure() {
      frame = 0;
      // Keep measuring during keyboard transitions and pinch zoom too. Freezing
      // a previous height when scale != 1 leaves a blank strip (or clips input).
      // These are already CSS-pixel coordinates; do not multiply by scale or
      // subtract the keyboard height from them a second time.
      const height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      if (height <= 0 || width <= 0) return;
      root.style.setProperty("--lfn-viewport-height", `${height}px`);
      root.style.setProperty("--lfn-viewport-width", `${width}px`);
      root.style.setProperty("--lfn-viewport-top", `${viewport?.offsetTop ?? 0}px`);
      root.style.setProperty("--lfn-viewport-left", `${viewport?.offsetLeft ?? 0}px`);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
    measure();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("pageshow", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pageshow", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      root.style.removeProperty("--lfn-viewport-height");
      root.style.removeProperty("--lfn-viewport-width");
      root.style.removeProperty("--lfn-viewport-top");
      root.style.removeProperty("--lfn-viewport-left");
    };
  }, []);
}
