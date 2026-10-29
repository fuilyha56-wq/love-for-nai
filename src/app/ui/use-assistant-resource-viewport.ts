"use client";
import { useMemo, useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("resize", listener); window.visualViewport?.addEventListener("resize", listener); window.visualViewport?.addEventListener("scroll", listener);
  return () => { window.removeEventListener("resize", listener); window.visualViewport?.removeEventListener("resize", listener); window.visualViewport?.removeEventListener("scroll", listener); };
}
function snapshot() { const viewport = window.visualViewport; return [viewport?.width || window.innerWidth, viewport?.height || window.innerHeight, viewport?.offsetLeft || 0, viewport?.offsetTop || 0].join(","); }
export function useAssistantResourceViewport() { const value = useSyncExternalStore(subscribe, snapshot, () => "0,0,0,0"); return useMemo(() => { const [width, height, left, top] = value.split(",").map(Number); return { width, height, left, top }; }, [value]); }
