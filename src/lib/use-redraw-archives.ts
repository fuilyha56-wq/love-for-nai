"use client";

import { useEffect, useState } from "react";
import { listLocalImageHistorySummaries, type LocalImageHistorySummary } from "@/lib/local-image-history";

export type RedrawArchiveRow = LocalImageHistorySummary & { archive: NonNullable<LocalImageHistorySummary["archive"]> };

export function useRedrawArchives(ownerId: number, query: string, operation: string) {
  const [state, setState] = useState<{ ownerId: number; items: RedrawArchiveRow[] }>();
  useEffect(() => {
    let active = true;
    const load = () => {
      void listLocalImageHistorySummaries().then((items) => {
        if (active) setState({ ownerId, items: items.filter((item): item is RedrawArchiveRow => item.ownerId === ownerId && Boolean(item.archive)) });
      }).catch(() => undefined);
    };
    load();
    window.addEventListener("focus", load);
    window.addEventListener("lfn-local-image-history-changed", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
      window.removeEventListener("lfn-local-image-history-changed", load);
    };
  }, [ownerId]);
  const items = state?.ownerId === ownerId ? state.items : [];
  const needle = query.trim().toLocaleLowerCase();
  const visible = operation === "all" || operation === "tiled-upscale"
    ? items.filter((item) => !needle || [item.prompt, item.model, "分块超分", `${item.archive.width}×${item.archive.height}`]
      .some((text) => text?.toLocaleLowerCase().includes(needle)))
    : [];
  return { count: items.length, visible };
}
