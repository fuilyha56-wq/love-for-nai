type Evidence = {
  evidenceId: string;
  ipHmac?: string;
  userId?: number;
  username?: string;
  lastSeenAt: string;
  requestCount: number;
  users?: Record<string, unknown>;
};

/** A user appears once; shared IP evidence remains available to each associated user. */
export function groupIpEvidence<T extends Evidence>(items: T[]) {
  const groups = new Map<string, { key: string; userId?: number; username?: string; lastSeenAt: string; requestCount: number; items: T[] }>();
  for (const item of items) {
    const ids = [...new Set([item.userId, ...Object.keys(item.users || {}).map(Number)])].filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0);
    for (const id of ids.length ? ids : [undefined]) {
      const key = id == null ? "unassociated" : String(id);
      const group = groups.get(key) || { key, userId: id, username: undefined, lastSeenAt: item.lastSeenAt, requestCount: 0, items: [] };
      const identity = item.ipHmac || item.evidenceId;
      const existing = group.items.findIndex(entry => (entry.ipHmac || entry.evidenceId) === identity);
      if (existing >= 0) {
        const previous = group.items[existing];
        group.items[existing] = { ...(Date.parse(item.lastSeenAt) > Date.parse(previous.lastSeenAt) ? item : previous), requestCount: previous.requestCount + item.requestCount };
      } else group.items.push(item);
      const usage = id == null ? undefined : item.users?.[String(id)];
      const userRequests = usage && typeof usage === "object" && "requestCount" in usage ? Number(usage.requestCount) : item.requestCount;
      group.requestCount += Number.isFinite(userRequests) ? userRequests : item.requestCount;
      if (item.userId === id && item.username && (!group.username || Date.parse(item.lastSeenAt) >= Date.parse(group.lastSeenAt))) group.username = item.username;
      if (Date.parse(item.lastSeenAt) > Date.parse(group.lastSeenAt)) group.lastSeenAt = item.lastSeenAt;
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}
