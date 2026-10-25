type HistoryIdentity = { image: string; historyId?: string; createdAt: number };

export function studioHistoryKey(item: HistoryIdentity): string {
  return item.historyId ? `account:${item.historyId}` : item.image;
}

/** New session results must remain visible while the account list is refreshing. */
export function mergeStudioHistory<T extends HistoryIdentity>(session: readonly T[], account: readonly T[]): T[] {
  const seen = new Set<string>();
  return [...session, ...account].filter((item) => {
    const key = studioHistoryKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.createdAt - a.createdAt);
}
