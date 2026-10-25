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
      if (viewport && viewport.scale !== 1) return;
      root.style.setProperty("--lfn-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty("--lfn-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
    measure();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      root.style.removeProperty("--lfn-viewport-height");
      root.style.removeProperty("--lfn-viewport-top");
    };
  }, []);
}
