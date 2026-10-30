export type TextMenuViewport = { left: number; top: number; width: number; height: number };

/** Keep text actions inside the same visible rectangle as the mobile workspace. */
export function readTextMenuViewport(): TextMenuViewport {
  const viewport = window.visualViewport;
  const style = document.documentElement.style;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const publishedLeft = Number.parseFloat(style.getPropertyValue("--lfn-viewport-left"));
  const publishedTop = Number.parseFloat(style.getPropertyValue("--lfn-viewport-top"));
  const publishedWidth = Number.parseFloat(style.getPropertyValue("--lfn-viewport-width"));
  const publishedHeight = Number.parseFloat(style.getPropertyValue("--lfn-viewport-height"));
  const x = Number.isFinite(publishedLeft) && publishedWidth > 0 ? Math.max(left, publishedLeft) : left;
  const y = Number.isFinite(publishedTop) && publishedHeight > 0 ? Math.max(top, publishedTop) : top;
  const right = Number.isFinite(publishedLeft) && publishedWidth > 0 ? Math.min(left + width, publishedLeft + publishedWidth) : left + width;
  const bottom = Number.isFinite(publishedTop) && publishedHeight > 0 ? Math.min(top + height, publishedTop + publishedHeight) : top + height;
  return { left: x, top: y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function placeTextMenu(position: { x: number; y: number }, size: { width: number; height: number }, viewport: TextMenuViewport) {
  const gap = 8;
  const maxWidth = Math.max(0, viewport.width - gap * 2);
  const maxHeight = Math.max(0, viewport.height - gap * 2);
  return {
    left: Math.max(viewport.left + gap, Math.min(position.x, viewport.left + viewport.width - Math.min(size.width, maxWidth) - gap)),
    top: Math.max(viewport.top + gap, Math.min(position.y, viewport.top + viewport.height - Math.min(size.height, maxHeight) - gap)),
    maxWidth,
    maxHeight,
  };
}
