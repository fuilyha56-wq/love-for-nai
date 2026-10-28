"use client";
import { useEffect, useState } from "react";
import { assistantReasoningProfile, resolveAssistantReasoning } from "@/lib/assistant-reasoning";
const key = "lfn-assistant-reasoning-v1";
const current: Record<string, string> = {};
export function storedAssistantReasoning(model: string) {
  try { return resolveAssistantReasoning(model, current[model] ?? JSON.parse(localStorage.getItem(key) || "{}")[model]); }
  catch { return resolveAssistantReasoning(model); }
}
export function AssistantReasoningControl({ model }: { model: string }) {
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
  return <label className="assistant-reasoning-control" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", fontSize: "11px", marginTop: "8px" }}>
    <span>思考强度 · {p.vendor}</span>
    <select aria-label="助手思考强度" className="field" style={{ width: "auto", minWidth: "96px", minHeight: "32px", marginLeft: "auto", padding: "4px 8px" }} value={selected} disabled={!p.levels.length} onChange={event => {
      current[model] = event.target.value;
      const next = { ...preferences, [model]: event.target.value }; setPreferences(next);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* current page selection remains usable */ }
      window.dispatchEvent(new CustomEvent("lfn-assistant-reasoning", { detail: { model, effort: event.target.value } }));
    }}>
      {p.levels.length ? p.levels.map(level => <option key={level} value={level}>{level === "none" ? "关闭" : level}{level === "high" ? " · 默认" : ""}</option>) : <option value="auto">上游默认</option>}
    </select>
    {p.note && <small style={{ width: "100%", color: "var(--muted)", lineHeight: 1.6 }}>{p.note}</small>}
  </label>;
}
