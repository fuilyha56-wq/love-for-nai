/** Match the workspace's visible area, including keyboards in overlay mode. */
export function promptOverlayViewport() {
  const style = getComputedStyle(document.documentElement);
  const viewport = window.visualViewport;
  const read = (name: string, fallback: number) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const left = read("--lfn-viewport-left", viewport?.offsetLeft ?? 0) + 8;
  const top = read("--lfn-viewport-top", viewport?.offsetTop ?? 0) + 8;
  const width = Math.max(0, read("--lfn-viewport-width", viewport?.width ?? window.innerWidth) - 16);
  const height = Math.max(0, read("--lfn-viewport-height", viewport?.height ?? window.innerHeight) - 16);
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** Reposition body portals when the pane scrolls or keyboard geometry changes. */
export function observePromptOverlay(place: () => void) {
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, { capture: true });
  window.visualViewport?.addEventListener("resize", place);
  window.visualViewport?.addEventListener("scroll", place);
  const observer = new MutationObserver(place);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  return () => {
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, { capture: true });
    window.visualViewport?.removeEventListener("resize", place);
    window.visualViewport?.removeEventListener("scroll", place);
    observer.disconnect();
  };
}
