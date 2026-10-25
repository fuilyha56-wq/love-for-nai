export const GUIDE_LAUNCHER_KEY = "lfn-mobile-guide-launcher-visible";
export const GUIDE_VISIBILITY_EVENT = "lfn-mobile-guide-visibility-change";
export const GUIDE_OPEN_EVENT = "lfn-mobile-guide-open";
export const GUIDE_KEY = "lfn-mobile-onboarding-v1";
const GUIDE_ACTIVE_EVENT = "lfn-mobile-guide-active-change";
let guideActive = false;

export function isGuideActive() {
  if (typeof window === "undefined") return true;
  if (guideActive) return true;
  try { return !window.localStorage.getItem(GUIDE_KEY); }
  catch { return true; }
}

export function setGuideActive(active: boolean) {
  guideActive = active;
  window.dispatchEvent(new Event(GUIDE_ACTIVE_EVENT));
}

export function subscribeGuideActive(listener: () => void) {
  window.addEventListener(GUIDE_ACTIVE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(GUIDE_ACTIVE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function guideLauncherVisible() {
  if (typeof window === "undefined") return true;
  try { return window.localStorage.getItem(GUIDE_LAUNCHER_KEY) !== "false"; }
  catch { return true; }
}

export function subscribeGuideVisibility(listener: () => void) {
  window.addEventListener(GUIDE_VISIBILITY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(GUIDE_VISIBILITY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function setGuideLauncherVisible(visible: boolean) {
  try { window.localStorage.setItem(GUIDE_LAUNCHER_KEY, String(visible)); }
  catch { return false; }
  window.dispatchEvent(new Event(GUIDE_VISIBILITY_EVENT));
  return true;
}

export function openOnboardingGuide() {
  setGuideActive(true);
  window.dispatchEvent(new Event(GUIDE_OPEN_EVENT));
}
