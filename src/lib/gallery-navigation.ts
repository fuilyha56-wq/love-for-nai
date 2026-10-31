export const GALLERY_POSITION_KEY = "lfn-gallery-position-v1";
export type GalleryPosition = { href: string; scrollY: number; savedAt: number };
export function galleryPosition(value: unknown, now: number): GalleryPosition | null {
  if (!value || typeof value !== "object") return null;
  const item = value as GalleryPosition;
  if (typeof item.href !== "string" || !galleryReturnHref(item.href) ||
    !Number.isFinite(item.scrollY) || item.scrollY < 0 || !Number.isFinite(item.savedAt) ||
    item.savedAt > now || now - item.savedAt > 24 * 60 * 60 * 1000) return null;
  return item;
}

/** Only collection routes can be used as a detail page's return destination. */
export function galleryReturnHref(value: unknown): string | null {
  return typeof value === "string" && value.length <= 2048 && /^\/gallery(?:\/activities)?(?:\?[^#]*)?$/.test(value) ? value : null;
}

export function galleryDetailHref(id: string, from: string): string {
  const target = galleryReturnHref(from) || "/gallery";
  return `/gallery/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(target)}`;
}

export function galleryReturnTarget(search: string) {
  const href = galleryReturnHref(new URLSearchParams(search).get("returnTo")) || "/gallery?restore=1";
  return { href, label: href.startsWith("/gallery/activities") ? "活动排行榜" : "图片广场" };
}
