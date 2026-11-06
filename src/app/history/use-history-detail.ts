"use client";

import { useEffect, useState } from "react";
import { findLocalImageHistory, type LocalImageHistoryItem } from "@/lib/local-image-history";
import { localHistoryImageSource } from "@/lib/local-history-image-source";

type HistoryParams = Promise<{ id: string }>;
type HistoryItem = {
  id: string;
  createdAt: string;
  imageUrl: string;
  parameters: Record<string, string | number | boolean>;
  archive?: LocalImageHistoryItem["archive"];
};

export function useHistoryDetail(params: HistoryParams, ownerId: number) {
  const [state, setState] = useState<{ params: HistoryParams; ownerId: number; item?: HistoryItem; message?: string }>();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const { id } = await params;
      const local = await findLocalImageHistory(id, ownerId).catch(() => null);
      if (controller.signal.aborted) return;
      if (local) {
        setState({ params, ownerId, item: {
          id: local.remoteId || local.id,
          createdAt: new Date(local.createdAt).toISOString(),
          imageUrl: localHistoryImageSource(local.id, Boolean(local.archive), ownerId),
          archive: local.archive,
          parameters: {
            prompt: local.prompt || "", negative_prompt: local.negative || "",
            model: local.model || "", operation: local.operation || "generate", ...local.parameters,
          } as HistoryItem["parameters"],
        } });
        return;
      }
      if (ownerId === 0) throw new Error("本机没有这张历史图片");
      const response = await fetch(`/api/history/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json() as HistoryItem & { message?: string };
      if (!response.ok) throw new Error(result.message || "读取历史失败");
      if (!controller.signal.aborted) setState({ params, ownerId, item: result });
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ params, ownerId, message: error instanceof Error ? error.message : "读取历史失败" });
      }
    });
    return () => controller.abort();
  }, [params, ownerId]);

  const loaded = state?.params === params && state.ownerId === ownerId ? state : undefined;
  return { item: loaded?.item, message: loaded?.message ?? "" };
}
