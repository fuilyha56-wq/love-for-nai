"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

export const MOBILE_VIEWPORT_QUERY = "(max-width: 1023px)";
function subscribe(listener: () => void) {
  const query = window.matchMedia(MOBILE_VIEWPORT_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
function getSnapshot() { return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches; }
function getServerSnapshot() { return false; }

const ViewportContext = createContext(false);

export function useMobileViewportMatch() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function ViewportDeviceProvider({ mobile, children }: { mobile: boolean; children: ReactNode }) {
  return <ViewportContext.Provider value={mobile}>{children}</ViewportContext.Provider>;
}

/** Only the active device UI mounts, so hidden forms cannot run side effects. */
export function ViewportPage({ desktop, mobile }: { desktop: ReactNode; mobile: ReactNode }) {
  const isMobile = useContext(ViewportContext);
  return <div className="viewport-surface" data-viewport-surface={isMobile ? "mobile" : "desktop"}>{isMobile ? mobile : desktop}</div>;
}
