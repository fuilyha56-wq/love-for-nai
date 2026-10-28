"use client";

import { useCallback, useEffect, useState, type SetStateAction } from "react";

// Route changes should not discard a generation, even with saving disabled or
// while IndexedDB is still writing. This cache lasts only for this open tab.
let currentScope: string | null = null;
let currentItems: unknown[] = [];

export function useStudioSessionHistory<T>(userId?: number) {
  const scope = userId ? String(userId) : "guest";
  const [state, setState] = useState<{ scope: string; items: T[] }>(() => {
    return { scope, items: currentScope === scope ? currentItems as T[] : [] };
  });
  if (state.scope !== scope) {
    setState({ scope, items: [] });
  }
  const items = state.items;
  useEffect(() => { currentScope = scope; currentItems = items; }, [items, scope]);
  const update = useCallback((next: SetStateAction<T[]>) => {
    setState(previous => {
      if (previous.scope !== scope) return previous;
      const value = typeof next === "function" ? (next as (items: T[]) => T[])(previous.items) : next;
      if (currentScope === scope) currentItems = value;
      return { scope, items: value };
    });
  }, [scope]);
  return [items, update] as const;
}
