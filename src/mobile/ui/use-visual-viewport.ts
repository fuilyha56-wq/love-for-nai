"use client";

import { useEffect } from "react";

type KeyboardGeometry = EventTarget & { boundingRect: { height: number } };

const editableSelector = 'textarea:not([readonly]):not([disabled]), input:not([readonly]):not([disabled]):is([type="text"], [type="search"], [type="email"], [type="url"], [type="tel"], [type="password"], [type="number"], :not([type]))';

/** The visual viewport shrinks for mobile keyboards even when 100dvh does not. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const keyboard = (navigator as Navigator & { virtualKeyboard?: KeyboardGeometry }).virtualKeyboard;
    const orientation = window.screen?.orientation;
    const root = document.documentElement;
    let frame = 0;
    let baselineHeight = window.innerHeight;
    let baselineWidth = window.innerWidth;
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

      const active = document.activeElement;
      const editing = !!active && (active.matches(editableSelector) || (active as HTMLElement).isContentEditable);
      // Retain the last unfocused height for browsers that resize both viewports.
      // A width/orientation change invalidates that portrait/landscape baseline.
      if (!editing || Math.abs(window.innerWidth - baselineWidth) > 1) {
        baselineHeight = window.innerHeight;
        baselineWidth = window.innerWidth;
      }
      const availableHeight = Math.max(baselineHeight, window.innerHeight);
      // Scale is used ONLY for this advisory estimate, never for layout geometry.
      // Pinch zoom alone is not a keyboard. Ignore small losses from browser bars.
      // Without native geometry, floating keyboards and other large resizes while
      // editing cannot be identified reliably; layout must not depend on this value.
      const heightLoss = Math.max(0, availableHeight - height * (viewport?.scale ?? 1));
      const estimatedHeight = editing && heightLoss > Math.max(120, availableHeight * 0.15) ? heightLoss : 0;
      // Some browsers expose VirtualKeyboard but leave its rect empty unless
      // overlaysContent is enabled. Keep normal browser resizing and fall back.
      const keyboardHeight = Math.max(0, keyboard?.boundingRect.height ?? 0) || estimatedHeight;
      root.style.setProperty("--lfn-keyboard-height", `${keyboardHeight}px`);
      root.dataset.keyboardOpen = keyboardHeight > 0 ? "true" : "false";
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
    function resetBaseline() {
      baselineHeight = window.innerHeight;
      baselineWidth = window.innerWidth;
      schedule();
    }
    measure();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("pageshow", schedule);
    window.addEventListener("orientationchange", resetBaseline);
    orientation?.addEventListener("change", resetBaseline);
    keyboard?.addEventListener("geometrychange", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pageshow", schedule);
      window.removeEventListener("orientationchange", resetBaseline);
      orientation?.removeEventListener("change", resetBaseline);
      keyboard?.removeEventListener("geometrychange", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      root.style.removeProperty("--lfn-viewport-height");
      root.style.removeProperty("--lfn-viewport-width");
      root.style.removeProperty("--lfn-viewport-top");
      root.style.removeProperty("--lfn-viewport-left");
      root.style.removeProperty("--lfn-keyboard-height");
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
