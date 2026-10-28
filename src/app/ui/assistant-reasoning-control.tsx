"use client";
import { useEffect, useState } from "react";
import { assistantReasoningProfile, resolveAssistantReasoning } from "@/lib/assistant-reasoning";
import { PopupSelect } from "./popup-select";
import "./assistant-reasoning-control.css";
const key = "lfn-assistant-reasoning-v1";
const current: Record<string, string> = {};
export function storedAssistantReasoning(model: string) {
  try { return resolveAssistantReasoning(model, current[model] ?? JSON.parse(localStorage.getItem(key) || "{}")[model]); }
  catch { return resolveAssistantReasoning(model); }
}
export function AssistantReasoningControl({ model, compact = false }: { model: string; compact?: boolean }) {
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  useEffect(() => {
    const load = () => { try { setPreferences({ ...JSON.parse(localStorage.getItem(key) || "{}"), ...current }); } catch { setPreferences({ ...current }); } };
    void Promise.resolve().then(load);
    window.addEventListener("lfn-assistant-reasoning", load);
    window.addEventListener("storage", load);
    return () => { window.removeEventListener("lfn-assistant-reasoning", load); window.removeEventListener("storage", load); };
  }, []);
  const p = assistantReasoningProfile(model);
  let selected: string;
  try { selected = resolveAssistantReasoning(model, preferences[model]) || "auto"; } catch { selected = resolveAssistantReasoning(model) || "auto"; }
  return <div className={`assistant-reasoning-control${compact ? " is-compact" : ""}`} title={`思考强度 · ${p.vendor}${p.note ? `：${p.note}` : ""}`}>
    <span>思考强度 · {p.vendor}</span>
    <PopupSelect ariaLabel="助手思考强度" className="assistant-reasoning-select" triggerClassName="assistant-reasoning-trigger" menuClassName="assistant-reasoning-menu"
      menuMinWidth={compact ? 150 : 0}
      value={selected} disabled={!p.levels.length}
      options={p.levels.length ? p.levels.map(level => ({ value: level, label: `${level === "none" ? "关闭" : level}${level === "high" && !compact ? " · 默认" : ""}` })) : [{ value: "auto", label: "上游默认" }]}
      onChange={effort => {
      current[model] = effort;
      const next = { ...preferences, [model]: effort }; setPreferences(next);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* current page selection remains usable */ }
      window.dispatchEvent(new CustomEvent("lfn-assistant-reasoning", { detail: { model, effort } }));
    }} />
    {p.note && <small>{p.note}</small>}
  </div>;
}
