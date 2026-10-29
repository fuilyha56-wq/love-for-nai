"use client";

import { useEffect, useState } from "react";
import { setWikipediaLookupEnabled, wikipediaLookupEnabled } from "@/lib/client-assistant-web";

export function AssistantWebControl({ disabled = false }: { disabled?: boolean }) {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const load = () => setEnabled(wikipediaLookupEnabled());
    void Promise.resolve().then(load);
    window.addEventListener("storage", load); window.addEventListener("lfn-assistant-wikipedia", load);
    return () => { window.removeEventListener("storage", load); window.removeEventListener("lfn-assistant-wikipedia", load); };
  }, []);
  return <button type="button" className="assistant-web-control" aria-label="Wikipedia 概念检索" aria-pressed={enabled} disabled={disabled && !enabled} onClick={() => { const next = !enabled; setWikipediaLookupEnabled(next); setEnabled(next); }}>Wikipedia 概念检索：{enabled ? "允许" : "关闭"}</button>;
}
