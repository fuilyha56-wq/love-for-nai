"use client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { GALLERY_POSITION_KEY, galleryPosition, galleryReturnHref, galleryReturnTarget } from "@/lib/gallery-navigation";

const subscribe = (listener: () => void) => { window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); };
export function useGalleryReturnTarget() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  return galleryReturnTarget(search);
}

export function useGalleryScrollRestoration(ready: boolean) {
  const target = useRef<number | null>(null);
  const rememberPosition = useCallback(() => {
    const href = galleryReturnHref(window.location.pathname + window.location.search);
    if (!href) return;
    try {
      const value = JSON.stringify({ href, scrollY: window.scrollY, savedAt: Date.now() });
      sessionStorage.setItem(GALLERY_POSITION_KEY + ":" + href, value);
      if (window.location.pathname === "/gallery") sessionStorage.setItem(GALLERY_POSITION_KEY, value);
    } catch { /* Collection navigation remains available without storage. */ }
  }, []);

  useEffect(() => {
    const href = window.location.pathname + window.location.search;
    try {
      const key = new URLSearchParams(window.location.search).has("restore") ? GALLERY_POSITION_KEY : GALLERY_POSITION_KEY + ":" + href;
      const saved = galleryPosition(JSON.parse(sessionStorage.getItem(key) || "null"), Date.now());
      target.current = saved?.scrollY ?? null;
    } catch { /* Ignore expired/corrupt positions. */ }
    let timer: ReturnType<typeof setTimeout>;
    const scroll = () => { clearTimeout(timer); timer = setTimeout(() => { if (target.current === null) rememberPosition(); }, 150); };
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pagehide", rememberPosition);
    return () => { clearTimeout(timer); window.removeEventListener("scroll", scroll); window.removeEventListener("pagehide", rememberPosition); };
  }, [rememberPosition]);

  useEffect(() => {
    if (!ready || target.current === null) return;
    const y = target.current;
    let stopped = false;
    let frame = 0;
    const restore = () => { if (!stopped) window.scrollTo({ top: y, behavior: "instant" }); };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore); };
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    // Next's own navigation scroll and late image/font layout can follow mount.
    const timers = [0, 100, 350, 800, 1400].map(delay => setTimeout(schedule, delay));
    const stop = () => { stopped = true; target.current = null; cancelAnimationFrame(frame); observer.disconnect(); timers.forEach(clearTimeout); };
    const finished = setTimeout(stop, 1800);
    window.addEventListener("wheel", stop, { once: true, passive: true });
    window.addEventListener("touchstart", stop, { once: true, passive: true });
    window.addEventListener("pointerdown", stop, { once: true });
    window.addEventListener("keydown", stop, { once: true });
    return () => { stop(); clearTimeout(finished); window.removeEventListener("wheel", stop); window.removeEventListener("touchstart", stop); window.removeEventListener("pointerdown", stop); window.removeEventListener("keydown", stop); };
  }, [ready]);
  return rememberPosition;
}
