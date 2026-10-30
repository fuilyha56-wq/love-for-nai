"use client";

import { useEffect } from "react";
import { getWorkspaceKeyboard, getWorkspaceViewport } from "./use-workspace-keyboard";

const editableSelector = 'textarea:not([readonly]):not([disabled]), input:not([readonly]):not([disabled]):is([type="text"], [type="search"], [type="email"], [type="url"], [type="tel"], [type="password"], [type="number"], :not([type]))';

/** The visual viewport shrinks for mobile keyboards even when 100dvh does not. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const keyboard = getWorkspaceKeyboard();
    const orientation = window.screen?.orientation;
    const root = document.documentElement;
    // Browser controls can occupy part of the layout viewport after the IME
    // closes. Measure CSS's dynamic viewport independently of our own height
    // variables, including on HTTP origins without VirtualKeyboard support.
    const dynamicViewport = typeof CSS !== "undefined" && CSS.supports("height", "100dvh")
      ? document.createElement("div") : null;
    if (dynamicViewport) {
      dynamicViewport.setAttribute("data-viewport-measure", "");
      dynamicViewport.setAttribute("aria-hidden", "true");
      dynamicViewport.style.cssText = "position:fixed;top:0;left:0;width:0;height:100dvh;visibility:hidden;pointer-events:none;contain:strict;";
      document.body.appendChild(dynamicViewport);
    }
    let frame = 0;
    let baselineHeight = window.innerHeight;
    let baselineWidth = window.innerWidth;
    let keyboardWasOpen = false;
    let nativeState: "unknown" | "visible" | "hidden" = "unknown";
    let transitionUntil = 0;
    let hiddenShrinkUntil = 0;
    let hiddenShrinkHandled: Element | null = null;
    let correctionUntil = 0;
    let correction: { from: number; target: number; start: number } | undefined;
    let geometryContext = "";
    let lastEditor: Element | null = null;
    let appliedHeight = 0;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const written = new Map<string, string>();
    function write(name: string, value: string) {
      if (written.get(name) === value) return;
      written.set(name, value);
      root.style.setProperty(name, value);
    }
    function measure() {
      frame = 0;
      let height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      if (height <= 0 || width <= 0) {
        if (performance.now() < transitionUntil) scheduleFrame();
        return;
      }
      let top = viewport?.offsetTop ?? 0;
      const scale = viewport?.scale ?? 1;
      let source = "visual";
      const active = document.activeElement;
      const editing = !!active && (active.matches(editableSelector) || (active as HTMLElement).isContentEditable);
      if (editing) lastEditor = active;
      // Keep the pre-keyboard baseline through blur/IME closing animations too.
      // Changing orientation or viewport width invalidates that baseline.
      const widthChanged = Math.abs(window.innerWidth - baselineWidth) > 1;
      if ((!editing && !keyboardWasOpen) || widthChanged) {
        baselineHeight = window.innerHeight;
        baselineWidth = window.innerWidth;
        keyboardWasOpen = false;
        if (widthChanged) nativeState = "unknown";
      }
      const availableHeight = Math.max(baselineHeight, window.innerHeight);
      const threshold = Math.max(120, availableHeight * 0.15);
      const rect = keyboard?.boundingRect;
      const layoutHeight = root.clientHeight || window.innerHeight;
      const unzoomed = Math.abs(scale - 1) < 0.01;
      const workspace = unzoomed ? getWorkspaceViewport() : undefined;
      const dynamicHeight = dynamicViewport?.getBoundingClientRect().height ?? 0;
      const usableDynamicHeight = unzoomed && Number.isFinite(dynamicHeight) && dynamicHeight > 0
        ? dynamicHeight : 0;
      // Native geometry is useful only in overlay mode and when it describes a
      // full-width, bottom-docked keyboard in layout CSS pixels. Never treat a
      // floating keyboard (or an invalid/transitional rect) as a page-wide inset.
      const docked = keyboard?.overlaysContent && rect &&
        [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.height > 0 && rect.y > top && rect.x <= 1 &&
        rect.x + rect.width >= window.innerWidth - 1 &&
        Math.abs(rect.y + rect.height - layoutHeight) <= 2;
      const empty = !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.width === 0 && rect.height === 0;
      if (!keyboard?.overlaysContent || !unzoomed || (!docked && !empty)) nativeState = "unknown";
      // Once visual metrics catch up, the dismissal override has done its job.
      // A later keyboard opening can retain focus too; do not carry the previous
      // full-height decision into that new opening while native geometry lags.
      if (nativeState === "hidden" && (!usableDynamicHeight ||
        (Math.abs(Math.min(height, usableDynamicHeight) - usableDynamicHeight) <= 2 && Math.abs(top) <= 2))) nativeState = "unknown";
      if (docked) {
        // At scale 1 the keyboard top is independent of VisualViewport: it can
        // recover space lost to a stale/undersized viewport report. While zoomed,
        // only clip the visible viewport; older engines use inconsistent rects.
        height = unzoomed ? rect.y - top : Math.min(height, rect.y - top);
        source = "keyboard";
        if (unzoomed) nativeState = "visible";
      } else if (keyboard?.overlaysContent && unzoomed && empty && nativeState !== "unknown") {
        // A working native API changing from docked to empty confirms dismissal,
        // even if Android retains input focus and its visual metrics still lag.
        // Restore the dynamic viewport, not the larger layout viewport hidden
        // behind browser toolbars. Do not preserve the keyboard's stale pan.
        if (usableDynamicHeight) {
          nativeState = "hidden";
          height = usableDynamicHeight;
          top = 0;
          source = "keyboard";
        } else {
          // Empty native geometry proves no occlusion, not that the entire
          // layout viewport is visible. Older engines keep visual authority.
          nativeState = "unknown";
        }
      }
      // Without validated native geometry, the visual rectangle is the only
      // authority, including resizes-content browsers. Switching to layout
      // height near equality also reset offsetTop and could move the sheet back
      // and forth as animation rounding crossed the old two-pixel boundary.
      // CSS dvh can bound an overstated visual rectangle, but both measurements
      // can expand together during dismissal (handled by the workspace bound
      // below). Do not mix unscaled CSS units with a zoomed visual rectangle.
      if (usableDynamicHeight) height = Math.min(height, usableDynamicHeight);
      // On the affected phones both VV and dvh overstate the closed height.
      // Only the pre-edit rectangle is a trustworthy restoration bound. Keep
      // it through blur, retained-focus dismissal and repeated keyboard visits.
      if (workspace) height = Math.min(height, Math.max(0, workspace.height - top));
      const availableVisualHeight = height;
      const now = performance.now();
      const context = workspace ? `${workspace.width}:${scale}:${top}:${viewport?.offsetLeft ?? 0}` : "";
      const contextChanged = context !== geometryContext;
      if (contextChanged) {
        geometryContext = context;
        hiddenShrinkUntil = correctionUntil = 0;
        correction = undefined;
      }
      // Only a pane whose old editor has actually disappeared may hold a brief
      // closing undershoot. Blur alone is not proof the input is hidden.
      const editorHidden = !!lastEditor && (lastEditor.isConnected === false ||
        !!lastEditor.closest?.("[hidden], [inert]"));
      if (!workspace || editing || height >= workspace.height - 2) hiddenShrinkHandled = null;
      else if (contextChanged) hiddenShrinkHandled = lastEditor;
      if (!workspace || editing || !editorHidden || height >= appliedHeight - 2) hiddenShrinkUntil = 0;
      else if (!hiddenShrinkUntil && keyboardWasOpen && hiddenShrinkHandled !== lastEditor && !contextChanged) {
        hiddenShrinkHandled = lastEditor;
        hiddenShrinkUntil = now + 50;
      }
      if (hiddenShrinkUntil && now < hiddenShrinkUntil) {
        correction = undefined;
        correctionUntil = 0;
        scheduleFrame();
        return;
      }
      hiddenShrinkUntil = 0;
      if (!workspace || !editing || source === "keyboard" || reducedMotion?.matches || height >= workspace.height - 2) {
        correction = undefined;
        correctionUntil = 0;
      } else {
        if (height < appliedHeight - 2) {
          // Shrink immediately: holding the old height leaves the input behind
          // the IME. Only a quick upward correction after this first shrink is
          // eased, and it can never extend beyond the latest visible rectangle.
          correction = undefined;
          correctionUntil = appliedHeight >= workspace.height - 2 && workspace.height - height > threshold ? now + 120 : 0;
        }
        if (correction && height < correction.target - 2) {
          correction = undefined;
          correctionUntil = 0;
        }
        if (!correction && height > appliedHeight + 2 && now < correctionUntil) {
          correction = { from: appliedHeight, target: height, start: now };
          correctionUntil = 0;
        }
        if (correction) {
          correction.target = height;
          const progress = Math.min(1, (now - correction.start) / 80);
          height = Math.min(height, correction.from + (correction.target - correction.from) * (1 - (1 - progress) ** 2));
          if (progress === 1) correction = undefined;
          else scheduleFrame();
        }
      }
      appliedHeight = height;
      write("--lfn-viewport-height", `${height}px`);
      write("--lfn-viewport-width", `${width}px`);
      write("--lfn-viewport-top", `${top}px`);
      write("--lfn-viewport-left", `${viewport?.offsetLeft ?? 0}px`);
      if (root.dataset.viewportSource !== source) root.dataset.viewportSource = source;

      const heightLoss = Math.max(0, (workspace?.height ?? availableHeight) - availableVisualHeight * scale);
      const estimatedHeight = (editing || keyboardWasOpen) && heightLoss > threshold ? heightLoss : 0;
      const nativeHeight = keyboard?.overlaysContent && rect && Number.isFinite(rect.height)
        ? Math.max(0, rect.height) : 0;
      const keyboardHeight = nativeState === "hidden" && source === "keyboard"
        ? 0 : nativeHeight || estimatedHeight;
      write("--lfn-keyboard-height", `${keyboardHeight}px`);
      const open = keyboardHeight > 0 ? "true" : "false";
      if (root.dataset.keyboardOpen !== open) root.dataset.keyboardOpen = open;
      keyboardWasOpen = keyboardHeight > 0;
      if (performance.now() < transitionUntil) scheduleFrame();
    }
    function scheduleFrame() { if (!frame) frame = requestAnimationFrame(measure); }
    function schedule() {
      // Android can notify before updating its metrics, including keyboard /
      // clipboard-panel swaps. Read each paint during this bounded transition,
      // not at sparse timeout checkpoints that leave the old layout on screen.
      transitionUntil = performance.now() + 750;
      // In resizes-content browsers the layout viewport is already smaller at
      // this event. Publish the workspace rectangle before the next paint,
      // rather than keeping a now-offscreen composer for another frame.
      if (getWorkspaceViewport() && Math.abs((viewport?.scale ?? 1) - 1) < 0.01) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        measure();
      } else scheduleFrame();
    }
    function focusIn() {
      // A new focus can start another keyboard opening before native geometry
      // catches up. The previous dismissal is no longer proof it is hidden.
      if (nativeState === "hidden") nativeState = "unknown";
      schedule();
    }
    function resetBaseline() {
      baselineHeight = window.innerHeight;
      baselineWidth = window.innerWidth;
      keyboardWasOpen = false;
      nativeState = "unknown";
      schedule();
    }
    measure();
    const dynamicObserver = dynamicViewport && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(schedule) : null;
    if (dynamicViewport) dynamicObserver?.observe(dynamicViewport);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("pageshow", schedule);
    window.addEventListener("orientationchange", resetBaseline);
    orientation?.addEventListener("change", resetBaseline);
    keyboard?.addEventListener("geometrychange", schedule);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      transitionUntil = 0;
      dynamicObserver?.disconnect();
      dynamicViewport?.remove();
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pageshow", schedule);
      window.removeEventListener("orientationchange", resetBaseline);
      orientation?.removeEventListener("change", resetBaseline);
      keyboard?.removeEventListener("geometrychange", schedule);
      document.removeEventListener("focusin", focusIn);
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
