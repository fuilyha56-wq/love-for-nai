"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Keep the surface mounted until its closing transition has finished. */
export function useAnimatedDisclosure(duration = 180) {
  const [state, setState] = useState({ open: false, present: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setOpen = useCallback((open: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const reduced = document.documentElement.dataset.motion === "reduced"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (open || reduced) {
      setState({ open, present: open });
    } else {
      setState((current) => ({ ...current, open: false }));
      timer.current = setTimeout(() => {
        timer.current = null;
        setState({ open: false, present: false });
      }, duration);
    }
  }, [duration]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { ...state, setOpen };
}
