"use client";
import { useEffect, useState } from "react";
import type { GallerySubmissionActivity } from "@/lib/gallery-submission-options";

export function useGallerySubmissionOptions(enabled: boolean) {
  const [state, setState] = useState({ activities: [] as GallerySubmissionActivity[], loading: enabled, offset: 0, now: 0 });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let transition: ReturnType<typeof setTimeout>;
    let sequence = 0;
    async function load() {
      const requestNumber = ++sequence;
      try {
        const response = await fetch("/api/gallery/submission-options", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("活动配置读取失败");
        const result = await response.json() as { activities: GallerySubmissionActivity[]; serverTime: number; nextChangeAt: number | null };
        if (controller.signal.aborted || requestNumber !== sequence) return;
        setState({ activities: result.activities, loading: false, offset: result.serverTime - Date.now(), now: result.serverTime });
        clearTimeout(transition);
        if (result.nextChangeAt) transition = setTimeout(() => { const localNow = Date.now(); setState(s => ({ ...s, now: localNow + s.offset })); void load(); }, Math.min(2_147_483_647, Math.max(100, result.nextChangeAt - result.serverTime + 50)));
      } catch { if (!controller.signal.aborted && requestNumber === sequence) setState({ activities: [], loading: false, offset: 0, now: 0 }); }
    }
    void load();
    const interval = setInterval(() => void load(), 30_000);
    const focus = () => { if (!document.hidden) void load(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => { controller.abort(); clearInterval(interval); clearTimeout(transition); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [enabled]);
  return { loading: state.loading, activities: enabled ? state.activities.filter(c => !c.endsAt || Date.parse(c.endsAt) > state.now) : [] };
}
