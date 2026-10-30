export function canonicalGalleryTag(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === "万圣节" ? "halloween" : normalized;
}
