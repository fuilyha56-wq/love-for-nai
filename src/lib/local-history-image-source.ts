const PREFIX = "lfn-local-history:";

/** A lazy IndexedDB image reference. Never assign this URL directly to an img. */
export function localHistoryImageSource(id: string, thumbnail = false, ownerId?: number): string {
  const query = new URLSearchParams();
  if (thumbnail) query.set("variant", "thumbnail");
  if (ownerId !== undefined) query.set("owner", String(ownerId));
  const suffix = query.toString();
  return `${PREFIX}${encodeURIComponent(id)}${suffix ? `?${suffix}` : ""}`;
}

export function parseLocalHistoryImageSource(source: string): { id: string; thumbnail: boolean; ownerId?: number } | null {
  if (!source.startsWith(PREFIX)) return null;
  const [encodedId, query] = source.slice(PREFIX.length).split("?");
  try {
    const id = decodeURIComponent(encodedId);
    const parameters = new URLSearchParams(query);
    const owner = parameters.get("owner");
    if (!id || (owner !== null && (!/^\d+$/.test(owner) || !Number.isSafeInteger(Number(owner))))) return null;
    return { id, thumbnail: parameters.get("variant") === "thumbnail", ...(owner !== null ? { ownerId: Number(owner) } : {}) };
  } catch { return null; }
}
