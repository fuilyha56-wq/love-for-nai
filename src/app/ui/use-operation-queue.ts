"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ClientOperationQueue } from "@/lib/client-operation-queue";

export function useOperationQueue(scope: string, limit = 10) {
  const queue = useMemo(() => new ClientOperationQueue(limit, scope), [scope, limit]);
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getServerSnapshot);
  useEffect(() => () => queue.cancelAll(), [queue, scope]);
  return { queue, items, running: items.some((item) => item.status === "running" || item.status === "cancelling"), pending: items.filter((item) => item.status === "queued") };
}
