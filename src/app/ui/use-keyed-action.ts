"use client";
import { useRef, useState } from "react";

export function useKeyedAction(report: (message: string) => void) {
  const active = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  async function run(key: string, task: () => Promise<void>) {
    if (active.current.has(key)) return;
    active.current.add(key); setPending(new Set(active.current));
    try { await task(); }
    catch (error) { report(error instanceof Error ? error.message : "操作失败，请稍后重试"); }
    finally { active.current.delete(key); setPending(new Set(active.current)); }
  }
  return { run, pending };
}
