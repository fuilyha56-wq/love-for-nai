const PREFIX = "lfn-local-history:";

/** A lazy IndexedDB image reference. Never assign this URL directly to an img. */
export function localHistoryImageSource(id: string, thumbnail = false): string {
  return `${PREFIX}${encodeURIComponent(id)}${thumbnail ? "?variant=thumbnail" : ""}`;
}

export function parseLocalHistoryImageSource(source: string): { id: string; thumbnail: boolean } | null {
  if (!source.startsWith(PREFIX)) return null;
  const [encodedId, query] = source.slice(PREFIX.length).split("?");
  try {
    const id = decodeURIComponent(encodedId);
    return id ? { id, thumbnail: new URLSearchParams(query).get("variant") === "thumbnail" } : null;
  } catch { return null; }
}
