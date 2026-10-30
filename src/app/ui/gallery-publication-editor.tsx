"use client";
import { useEffect, useState } from "react";
import { GalleryPublicationFields } from "@/app/ui/gallery-publication-fields";
import type {
  GalleryPublicationInput,
  GalleryPromptMode,
} from "@/lib/gallery-publication";

export function GalleryPublicationEditor({
  item,
}: {
  item: {
    id: string;
    ownerId?: number;
    promptMode?: string;
    requireLikeForParameters?: boolean;
  };
}) {
  const [isOwner, setIsOwner] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<
    GalleryPublicationInput & {
      exposeParameters: boolean;
      source: string;
      requireLikeForParameters?: boolean;
    }
  >({
    promptMode: (item.promptMode as GalleryPromptMode) || "full",
    exposeParameters: true,
    source: "local",
    requireLikeForParameters: item.requireLikeForParameters,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/me", { signal: controller.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((result) =>
        setIsOwner(
          Boolean(
            item.ownerId &&
            result.authenticated &&
            result.user?.id === item.ownerId,
          ),
        ),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [item.ownerId]);
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/gallery/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setMessage(result.message);
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修改失败");
    } finally {
      setBusy(false);
    }
  }
  if (!isOwner) return null;
  return (
    <section className="my-4 space-y-3">
      <button
        type="button"
        className="lfn-button"
        onClick={() => setOpen((value) => !value)}
      >
        调整我的提示词公开方式
      </button>
      {open && (
        <>
          <p className="text-xs text-[var(--muted)]">
            保存后重新审核，原榜单互动成绩不会带入新的参赛版本。部分公开内容请重新填写，系统从私有来源校验。
          </p>
          <GalleryPublicationFields
            form={draft}
            onChange={(patch) =>
              setDraft((current) => ({ ...current, ...patch }))
            }
          />
          <button
            type="button"
            className="lfn-button"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "校验并保存…" : "校验并重新提交审核"}
          </button>
        </>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
