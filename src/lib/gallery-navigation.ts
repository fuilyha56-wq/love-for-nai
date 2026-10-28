export const GALLERY_POSITION_KEY = "lfn-gallery-position-v1";
export type GalleryPosition = { href: string; scrollY: number; savedAt: number };
export function galleryPosition(value: unknown, now: number): GalleryPosition | null {
  if (!value || typeof value !== "object") return null;
  const item = value as GalleryPosition;
  if (typeof item.href !== "string" || !/^\/gallery(?:\?[^#]*)?$/.test(item.href) ||
    !Number.isFinite(item.scrollY) || item.scrollY < 0 || !Number.isFinite(item.savedAt) ||
    item.savedAt > now || now - item.savedAt > 24 * 60 * 60 * 1000) return null;
  return item;
}
