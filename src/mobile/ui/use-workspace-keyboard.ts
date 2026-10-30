"use client";

import { useLayoutEffect } from "react";

export type WorkspaceKeyboard = EventTarget & {
  boundingRect: { x: number; y: number; width: number; height: number };
  overlaysContent: boolean;
};

export function getWorkspaceKeyboard() {
  return (navigator as Navigator & { virtualKeyboard?: WorkspaceKeyboard }).virtualKeyboard;
}

const editableSelector = 'textarea:not([readonly]):not([disabled]), input:not([readonly]):not([disabled]):is([type="text"], [type="search"], [type="email"], [type="url"], [type="tel"], [type="password"], [type="number"], :not([type]))';

function isTextEntryFocused() {
  const active = document.activeElement;
  return !!active && (active.matches(editableSelector) || (active as HTMLElement).isContentEditable);
}

/** Only the full-screen workspace owns keyboard occlusion and background scroll. */
export function useWorkspaceKeyboard(open: boolean) {
  useLayoutEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const body = document.body;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const properties = ["position", "top", "left", "width", "height", "overflow"] as const;
    const previous = properties.map(name => [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)] as const);
    const rootOverflow = root.style.getPropertyValue("overflow");
    const rootPriority = root.style.getPropertyPriority("overflow");
    root.style.setProperty("overflow", "hidden");
    body.style.setProperty("position", "fixed");
    body.style.setProperty("top", `${-scrollY}px`);
    body.style.setProperty("left", `${-scrollX}px`);
    body.style.setProperty("width", "100%");
    body.style.setProperty("height", "100%");
    body.style.setProperty("overflow", "hidden");

    // Opt in before focusing an editor. Other pages keep native browser behavior.
    // Without this opt-in Chromium normally reports an empty keyboard rectangle.
    const keyboard = getWorkspaceKeyboard();
    const previousOverlay = keyboard?.overlaysContent;
    const viewport = window.visualViewport;
    let overlayEnabled = false;
    let observedGeometry = false;
    let verification: ReturnType<typeof setTimeout> | undefined;
    const unzoomed = () => Math.abs((viewport?.scale ?? 1) - 1) < 0.01;
    function clearVerification() {
      if (verification !== undefined) clearTimeout(verification);
      verification = undefined;
    }
    function hasUsableGeometry() {
      const rect = keyboard?.boundingRect;
      const layoutHeight = root.clientHeight || window.innerHeight;
      return !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.height > 0 && rect.y > (viewport?.offsetTop ?? 0) && rect.x <= 1 &&
        rect.x + rect.width >= window.innerWidth - 1 &&
        Math.abs(rect.y + rect.height - layoutHeight) <= 2;
    }
    function restoreBrowserBehavior() {
      if (!overlayEnabled || !keyboard) return;
      // This latch lasts until the workspace closes. Re-enabling on a later
      // focus/resize would make the keyboard and browser fight over the viewport.
      overlayEnabled = false;
      clearVerification();
      keyboard.overlaysContent = previousOverlay ?? false;
      window.dispatchEvent(new Event("resize"));
    }
    function inspectKeyboard() {
      if (!overlayEnabled) return;
      // Older Android engines report native keyboard coordinates inconsistently
      // while zoomed; return ownership to the browser for this workspace visit.
      if (!unzoomed()) {
        restoreBrowserBehavior();
        return;
      }
      if (hasUsableGeometry()) {
        observedGeometry = true;
        clearVerification();
        return;
      }
      // Once geometry has worked, an empty rect is a normal keyboard dismissal,
      // including dismissal while the textarea retains focus.
      if (observedGeometry || !isTextEntryFocused()) {
        clearVerification();
        return;
      }
      if (verification === undefined) {
        verification = setTimeout(() => {
          verification = undefined;
          if (!unzoomed()) restoreBrowserBehavior();
          else if (hasUsableGeometry()) observedGeometry = true;
          else if (isTextEntryFocused()) restoreBrowserBehavior();
        }, 900);
      }
    }
    if (keyboard && unzoomed()) {
      keyboard.overlaysContent = true;
      overlayEnabled = keyboard.overlaysContent;
    }
    viewport?.addEventListener("resize", inspectKeyboard);
    window.addEventListener("resize", inspectKeyboard);
    keyboard?.addEventListener("geometrychange", inspectKeyboard);
    document.addEventListener("focusin", inspectKeyboard);
    document.addEventListener("focusout", inspectKeyboard);
    inspectKeyboard();
    window.dispatchEvent(new Event("resize"));
    return () => {
      overlayEnabled = false;
      clearVerification();
      viewport?.removeEventListener("resize", inspectKeyboard);
      window.removeEventListener("resize", inspectKeyboard);
      keyboard?.removeEventListener("geometrychange", inspectKeyboard);
      document.removeEventListener("focusin", inspectKeyboard);
      document.removeEventListener("focusout", inspectKeyboard);
      if (keyboard) keyboard.overlaysContent = previousOverlay ?? false;
      for (const [name, value, priority] of previous) {
        if (value) body.style.setProperty(name, value, priority);
        else body.style.removeProperty(name);
      }
      if (rootOverflow) root.style.setProperty("overflow", rootOverflow, rootPriority);
      else root.style.removeProperty("overflow");
      window.scrollTo(scrollX, scrollY);
      window.dispatchEvent(new Event("resize"));
    };
  }, [open]);
}
