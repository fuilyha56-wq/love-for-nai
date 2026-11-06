"use client";

import { useEffect, useRef } from "react";

type PanelEntry = { path: string; value: string | null };

/** Give panels a browser-back boundary, consuming it when they close. */
export function usePanelHistory(key: string, value: string | null, restore: (value: string | null) => void) {
  const latest = useRef({ value, restore });
  const restored = useRef<{ value: string | null } | null>(null);
  const closing = useRef(false);
  const ready = useRef(false);
  useEffect(() => { latest.current = { value, restore }; });
  useEffect(() => {
    const path = window.location.pathname;
    const read = (): PanelEntry | undefined => window.history.state?.[key];
    const entry = read();
    if (entry?.path === path && entry.value !== latest.current.value) {
      restored.current = { value: entry.value };
      latest.current.restore(entry.value);
    }
    ready.current = true;
    const onPop = (event: PopStateEvent) => {
      const wasClosing = closing.current;
      closing.current = false;
      if (window.location.pathname !== path) return;
      const next: PanelEntry | undefined = event.state?.[key];
      const nextValue = next?.path === path ? next.value : null;
      // A new panel can open while the previous close is still waiting for
      // browser history to move. Give the new panel its own back boundary.
      if (wasClosing && latest.current.value !== null && nextValue !== latest.current.value) {
        writePanelEntry(key, path, nextValue, latest.current.value);
        return;
      }
      if (nextValue === latest.current.value) return;
      restored.current = { value: nextValue };
      latest.current.restore(nextValue);
    };
    window.addEventListener("popstate", onPop);
    return () => { ready.current = false; closing.current = false; window.removeEventListener("popstate", onPop); };
  }, [key]);
  useEffect(() => {
    if (!ready.current || closing.current) return;
    if (restored.current) {
      if (restored.current.value === value) restored.current = null;
      return;
    }
    const path = window.location.pathname;
    const entry: PanelEntry | undefined = window.history.state?.[key];
    const previous = entry?.path === path ? entry.value : null;
    if (previous === value) return;
    if (value === null) {
      closing.current = true;
      window.history.back();
    } else {
      writePanelEntry(key, path, previous, value);
    }
  }, [key, value]);
}

function writePanelEntry(key: string, path: string, previous: string | null, value: string) {
  const state = { ...window.history.state, [key]: { path, value } };
  if (previous === null) window.history.pushState(state, "", window.location.href);
  else window.history.replaceState(state, "", window.location.href);
}
