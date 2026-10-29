"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Keep keyboard navigation inside a modal while allowing its portalled menus. */
export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.focus({ preventScroll: true });
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab" || event.defaultPrevented || !dialog) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".feature-tutorial-panel")) return;
      // Selects and nested dialogs manage their own focus and return it on close.
      if (target && !dialog.contains(target) && target.closest('[role="listbox"], [role="menu"], [role="dialog"], dialog, [popover]')) return;
      const items = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter((item) => !item.closest('[inert], [hidden], [aria-hidden="true"]') && item.getClientRects().length > 0 && getComputedStyle(item).visibility !== "hidden");
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      requestAnimationFrame(() => {
        if (previous?.isConnected && !previous.closest("[inert], [hidden]")) previous.focus({ preventScroll: true });
      });
    };
  }, [open, ref]);
}
