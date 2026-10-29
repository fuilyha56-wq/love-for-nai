"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_GOAL_GENERATIONS, validGoalGenerations } from "@/lib/assistant-limits";
import { type AssistantCallUsage, type AssistantImageReceipt } from "@/lib/assistant-usage";
const roundsKey = "lfn-goal-max-rounds-v1";
export function useGoalRoundLimit() {
  const [rounds, setRounds] = useState(DEFAULT_GOAL_GENERATIONS);
  useEffect(() => {
    try { const saved = Number(localStorage.getItem(roundsKey)); if (validGoalGenerations(saved)) void Promise.resolve().then(() => setRounds(saved)); } catch { /* storage is optional */ }
  }, []);
  return [rounds, (value: number) => {
    if (!validGoalGenerations(value)) return;
    setRounds(value);
    try { localStorage.setItem(roundsKey, String(value)); } catch { /* current selection remains usable */ }
  }] as const;
}

export type UsageState = { scope: string; jobs: Record<string, AssistantCallUsage[]>; openJobs: string[]; images: Record<string, AssistantImageReceipt> };
export function useAssistantUsage() {
  const [state, setState] = useState<UsageState>({ scope: "", jobs: {}, openJobs: [], images: {} });
  const current = useRef(state);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const commit = useCallback((next: UsageState) => { current.current = next; setState(next); }, []);
  const start = useCallback((scope: string) => { commit({ scope, jobs: {}, openJobs: [], images: {} }); setError(""); }, [commit]);
  const recordJob = useCallback((scope: string, id: string, calls: AssistantCallUsage[], status = "running") => {
    if (current.current.scope !== scope) return;
    const openJobs = status === "running" ? [...new Set([...current.current.openJobs, id])] : current.current.openJobs.filter(job => job !== id);
    commit({ ...current.current, openJobs, jobs: { ...current.current.jobs, [id]: calls } });
  }, [commit]);
  const recordImage = useCallback((scope: string, id: string | null) => {
    if (!id || current.current.scope !== scope || current.current.images[id]) return;
    commit({ ...current.current, images: { ...current.current.images, [id]: { id, aff: null, balanceCost: null, billing: "pending" } } });
  }, [commit]);
  const restore = useCallback((id: string, calls: AssistantCallUsage[] | undefined) => {
    if (!current.current.scope && calls?.length) commit({ scope: "history", jobs: { [id]: calls }, openJobs: [], images: {} });
  }, [commit]);
  const refresh = useCallback(async () => {
    const snapshot = current.current;
    const jobs = Object.entries(snapshot.jobs).filter(([id, calls]) => snapshot.openJobs.includes(id) || calls.some(call => call.billing !== "settled")).map(([id]) => id);
    const images = Object.values(snapshot.images).filter(image => image.billing !== "settled").map(image => image.id);
    if (!jobs.length && !images.length) return;
    setRefreshing(true); setError("");
    try {
      const response = await fetch("/api/assistant/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobs, images }), cache: "no-store" });
      if (!response.ok) throw new Error("用量暂时无法刷新，请稍后重试。");
      const result = await response.json() as { jobs: Record<string, { status: string; usage: AssistantCallUsage[] }>; images: AssistantImageReceipt[] };
      if (current.current.scope !== snapshot.scope) return;
      // Keep newer polling snapshots; settled receipts can only improve their cost fields.
      const nextJobs = { ...current.current.jobs };
      for (const [id, { usage: calls }] of Object.entries(result.jobs)) {
        const updated = new Map(calls.map(call => [call.id, call]));
        const existing = new Map((nextJobs[id] ?? []).map(call => [call.id, call]));
        for (const call of calls) if (!existing.has(call.id) || call.billing === "settled") existing.set(call.id, updated.get(call.id)!);
        nextJobs[id] = [...existing.values()];
      }
      const openJobs = current.current.openJobs.filter(id => !result.jobs[id] || result.jobs[id].status === "running");
      commit({ ...current.current, openJobs, jobs: nextJobs, images: { ...current.current.images, ...Object.fromEntries(result.images.map(image => [image.id, image])) } });
    } catch (error) { if (current.current.scope === snapshot.scope) setError(error instanceof Error ? error.message : "用量刷新失败"); }
    finally { setRefreshing(false); }
  }, [commit]);
  // NewAPI logs can appear after the model response or streaming image completion.
  const pending = state.openJobs.length > 0 || Object.values(state.jobs).some(calls => calls.some(call => call.billing === "pending")) || Object.values(state.images).some(image => image.billing === "pending");
  useEffect(() => {
    if (!pending) return;
    let attempts = 0;
    const timer = window.setInterval(() => { if (++attempts > 6) { window.clearInterval(timer); return; } void refresh(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [pending, state.scope, refresh]);
  return { state, start, recordJob, recordImage, restore, refresh, refreshing, error };
}


export type AssistantUsage = ReturnType<typeof useAssistantUsage>;
