/** Keep the source family and limit tier when entering either image editor. */
export function inpaintModelFor(model: string): string | null {
  const match = model.match(/^nai-(v5|v4\.5|v3)(-furry)?(?:-full|-curated|-inpaint)?(-limit)?$/);
  if (!match || (match[2] && match[1] !== "v3")) return null;
  return `nai-${match[1]}${match[2] || ""}-inpaint${match[3] || ""}`;
}
