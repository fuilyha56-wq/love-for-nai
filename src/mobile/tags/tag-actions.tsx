"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyTextToClipboard } from "@/lib/client-clipboard";

export function TagActions({ value }: { value: string }) {
  const [feedback, setFeedback] = useState("");
  return <div className="flex flex-wrap items-center gap-3"><button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-4 text-sm" onClick={async () => { try { await copyTextToClipboard(value); setFeedback("已复制标签"); } catch { setFeedback("复制失败，请选择文字复制"); } }}>{feedback === "已复制标签" ? <Check size={18} /> : <Copy size={18} />}复制标签</button>{feedback && <span role="status" className="text-xs text-[var(--muted)]">{feedback}</span>}</div>;
}
