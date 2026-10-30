"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { findLocalImageHistory, listLocalImageHistorySummaries } from "@/lib/local-image-history";
import { galleryHistoryItems, type GalleryHistoryImage, type RemoteGalleryHistoryImage } from "@/lib/gallery-history-items";
export type { GalleryHistoryImage } from "@/lib/gallery-history-items";

async function historyOwnerScope(signal: AbortSignal) {
  const response = await fetch("/api/images/cache-scope", { cache: "no-store", signal });
  if (!response.ok) throw new Error("无法确认登录状态，请稍后重试。");
  const value = await response.json();
  if (typeof value.scope !== "string") throw new Error("无法确认登录状态，请刷新重试。");
  return value.scope;
}

export function useGalleryHistory(onIdentityChange?: () => void) {
  const [revision, setRevision] = useState(0);
  const [identityRevision, setIdentityRevision] = useState(0);
  const identityScopeRef = useRef<string | null>(null);
  const notifyIdentityChanged = useEffectEvent(() => onIdentityChange?.());
  const [state, setState] = useState<{ items: GalleryHistoryImage[]; loading: boolean; error: string; warning: string }>({ items: [], loading: true, error: "", warning: "" });

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let ownerScope = "";
    const rememberIdentityScope = (scope: string, force = false) => {
      if (!alive || controller.signal.aborted) return;
      const previous = identityScopeRef.current;
      identityScopeRef.current = scope;
      if (force || (previous !== null && previous !== scope)) {
        setIdentityRevision(value => value + 1);
        notifyIdentityChanged();
      }
    };
    void (async () => {
      try {
        const beforeScope = await historyOwnerScope(controller.signal);
        if (beforeScope === "guest") { rememberIdentityScope(beforeScope); throw new Error("请登录后选择图片历史。"); }
        const response = await fetch("/api/history", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "历史图片加载失败，请重试。");
        const ownerId = Number(data.userId);
        if (!Array.isArray(data.items)) throw new Error("历史图片数据不完整，请刷新重试。");
        const confirmedOwner = Number.isSafeInteger(ownerId) && ownerId > 0;
        let warning = confirmedOwner ? "" : "当前仅显示账号历史，本机历史所属账号暂未确认。";
        const local = confirmedOwner ? await listLocalImageHistorySummaries().catch(() => { warning = "本机历史暂时无法读取，账号历史仍可选择。"; return []; }) : [];
        const afterScope = await historyOwnerScope(controller.signal);
        if (beforeScope !== afterScope || (confirmedOwner && afterScope !== `user:${ownerId}`)) { rememberIdentityScope(afterScope, true); throw new Error("登录账号已变更，请刷新历史图片。"); }
        if (!alive) return;
        rememberIdentityScope(afterScope);
        ownerScope = afterScope;
        const items = galleryHistoryItems(data.items as RemoteGalleryHistoryImage[], local, confirmedOwner ? ownerId : undefined);
        setState({ items, loading: false, error: "", warning });
      } catch (error) {
        if (alive && !controller.signal.aborted) setState({ items: [], loading: false, warning: "", error: error instanceof Error ? error.message : "历史图片加载失败，请重试。" });
      }
    })();
    const verifyOwner = () => {
      if (document.hidden || !ownerScope) return;
      void historyOwnerScope(controller.signal).then(scope => {
        if (alive && scope !== ownerScope && scope !== identityScopeRef.current) { rememberIdentityScope(scope); setState({ items: [], loading: true, error: "", warning: "" }); setRevision(value => value + 1); }
      }).catch(() => {});
    };
    window.addEventListener("focus", verifyOwner);
    document.addEventListener("visibilitychange", verifyOwner);
    return () => { alive = false; controller.abort(); window.removeEventListener("focus", verifyOwner); document.removeEventListener("visibilitychange", verifyOwner); };
  }, [revision]);

  async function resolveSelection(item: GalleryHistoryImage): Promise<GalleryHistoryImage> {
    const beforeScope = await historyOwnerScope(new AbortController().signal);
    if (beforeScope === "guest" || beforeScope !== identityScopeRef.current) throw new Error("登录账号已变更，请刷新历史图片后重新选择。");
    if (!item.localId) return item;
    const original = await findLocalImageHistory(item.localId);
    if (!original || original.id !== item.localId || original.ownerId !== item.ownerId || beforeScope !== `user:${original.ownerId}`) throw new Error("本机历史原图已不可用，请刷新后重新选择。");
    const afterScope = await historyOwnerScope(new AbortController().signal);
    if (afterScope !== beforeScope) throw new Error("登录账号已变更，请刷新历史图片后重新选择。");
    const type = original.image.type || "image/png";
    return { ...item, file: new File([original.image], `history-${original.createdAt}.${type === "image/jpeg" ? "jpg" : "png"}`, { type }) };
  }

  return { ...state, identityRevision, resolveSelection, refresh: () => { setState({ items: [], loading: true, error: "", warning: "" }); setRevision(value => value + 1); } };
}
