"use client";
import { useEffect, useState } from "react";
import { assistantReasoningProfile, resolveAssistantReasoning } from "@/lib/assistant-reasoning";
import { PopupSelect } from "./popup-select";
import "./assistant-reasoning-control.css";
import { assistantReasoningPreferences, saveAssistantReasoning } from "@/lib/client-assistant-reasoning";
export { storedAssistantReasoning } from "@/lib/client-assistant-reasoning";
export function AssistantReasoningControl({ model, compact = false, disabled = false }: { model: string; compact?: boolean; disabled?: boolean }) {
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  useEffect(() => {
    const load = () => setPreferences(assistantReasoningPreferences());
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
      value={selected} disabled={disabled || !p.levels.length}
      options={p.levels.length ? p.levels.map(level => ({ value: level, label: `${level === "none" ? "关闭" : level}${level === "high" && !compact ? " · 默认" : ""}` })) : [{ value: "auto", label: "上游默认" }]}
      onChange={effort => {
      setPreferences(saveAssistantReasoning(model, effort));
    }} />
    {p.note && <small>{p.note}</small>}
  </div>;
}
