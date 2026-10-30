"use client";

import { useEffect } from "react";
import { getWorkspaceKeyboard } from "./use-workspace-keyboard";

const editableSelector = 'textarea:not([readonly]):not([disabled]), input:not([readonly]):not([disabled]):is([type="text"], [type="search"], [type="email"], [type="url"], [type="tel"], [type="password"], [type="number"], :not([type]))';

/** The visual viewport shrinks for mobile keyboards even when 100dvh does not. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const keyboard = getWorkspaceKeyboard();
    const orientation = window.screen?.orientation;
    const root = document.documentElement;
    let frame = 0;
    let baselineHeight = window.innerHeight;
    let baselineWidth = window.innerWidth;
    let keyboardWasOpen = false;
    let settling: ReturnType<typeof setTimeout>[] = [];
    function measure() {
      frame = 0;
      let height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      if (height <= 0 || width <= 0) return;
      let top = viewport?.offsetTop ?? 0;
      const scale = viewport?.scale ?? 1;
      let source = "visual";
      const active = document.activeElement;
      const editing = !!active && (active.matches(editableSelector) || (active as HTMLElement).isContentEditable);
      // Keep the pre-keyboard baseline through blur/IME closing animations too.
      // Changing orientation or viewport width invalidates that baseline.
      if ((!editing && !keyboardWasOpen) || Math.abs(window.innerWidth - baselineWidth) > 1) {
        baselineHeight = window.innerHeight;
        baselineWidth = window.innerWidth;
        keyboardWasOpen = false;
      }
      const availableHeight = Math.max(baselineHeight, window.innerHeight);
      const threshold = Math.max(120, availableHeight * 0.15);
      const rect = keyboard?.boundingRect;
      const layoutHeight = root.clientHeight || window.innerHeight;
      const unzoomed = Math.abs(scale - 1) < 0.01;
      // Native geometry is useful only in overlay mode and when it describes a
      // full-width, bottom-docked keyboard in layout CSS pixels. Never treat a
      // floating keyboard (or an invalid/transitional rect) as a page-wide inset.
      const docked = keyboard?.overlaysContent && rect &&
        [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.height > 0 && rect.y > top && rect.x <= 1 &&
        rect.x + rect.width >= window.innerWidth - 1 &&
        Math.abs(rect.y + rect.height - layoutHeight) <= 2;
      if (docked) {
        // At scale 1 the keyboard top is independent of VisualViewport: it can
        // recover space lost to a stale/undersized viewport report. While zoomed,
        // only clip the visible viewport; older engines use inconsistent rects.
        height = unzoomed ? rect.y - top : Math.min(height, rect.y - top);
        source = "keyboard";
      } else if (!keyboard?.overlaysContent && unzoomed && (editing || keyboardWasOpen) &&
        availableHeight - layoutHeight > threshold && Math.abs(layoutHeight - window.innerHeight) <= 2 &&
        Math.abs(height - layoutHeight) <= 2) {
        // resizes-content: use the layout size only when the visual size agrees.
        // A smaller layout alone can also mean split-screen/window resizing;
        // expanding a truly keyboard-occluded visual viewport would hide input.
        height = layoutHeight;
        top = 0;
        source = "layout";
      }
      root.style.setProperty("--lfn-viewport-height", `${height}px`);
      root.style.setProperty("--lfn-viewport-width", `${width}px`);
      root.style.setProperty("--lfn-viewport-top", `${top}px`);
      root.style.setProperty("--lfn-viewport-left", `${viewport?.offsetLeft ?? 0}px`);
      root.dataset.viewportSource = source;

      const heightLoss = Math.max(0, availableHeight - height * scale);
      const estimatedHeight = (editing || keyboardWasOpen) && heightLoss > threshold ? heightLoss : 0;
      const keyboardHeight = Math.max(0, rect?.height ?? 0) || estimatedHeight;
      root.style.setProperty("--lfn-keyboard-height", `${keyboardHeight}px`);
      root.dataset.keyboardOpen = keyboardHeight > 0 ? "true" : "false";
      keyboardWasOpen = keyboardHeight > 0;
    }
    function scheduleFrame() { if (!frame) frame = requestAnimationFrame(measure); }
    function schedule() {
      scheduleFrame();
      // Some mobile engines notify before their final IME geometry is available.
      // Bounded trailing reads cover that transition without a permanent poll.
      settling.forEach(clearTimeout);
      settling = [60, 180, 350, 600].map(delay => setTimeout(scheduleFrame, delay));
    }
    function resetBaseline() {
      baselineHeight = window.innerHeight;
      baselineWidth = window.innerWidth;
      keyboardWasOpen = false;
      schedule();
    }
    measure();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", scheduleFrame);
    window.addEventListener("resize", schedule);
    window.addEventListener("pageshow", schedule);
    window.addEventListener("orientationchange", resetBaseline);
    orientation?.addEventListener("change", resetBaseline);
    keyboard?.addEventListener("geometrychange", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      settling.forEach(clearTimeout);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", scheduleFrame);
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
      delete root.dataset.viewportSource;
    };
  }, []);
}
