"use client";

import { useEffect, useState } from "react";
import { ASSISTANT_MEMORY_LIMIT, type AssistantCreativeMemory } from "@/lib/assistant-memory";
import { clearCreativeMemoryState, readCreativeMemoryState, saveCreativeMemoryState, type CreativeMemoryState } from "@/lib/client-assistant-memory";
import "./assistant-memory-editor.css";

export function AssistantMemoryEditor({ disabled = false }: { disabled?: boolean }) {
  const [memory, setMemory] = useState<CreativeMemoryState>({ enabled: false, entries: [] });
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const load = () => { try { setMemory(readCreativeMemoryState()); } catch (error) { setNotice(error instanceof Error ? error.message : "无法读取本机创作记忆。"); } };
    void Promise.resolve().then(load);
    return () => {};
  }, []);
  function update(index: number, field: keyof AssistantCreativeMemory, value: string) {
    setMemory((current) => ({ ...current, entries: current.entries.map((entry, at) => at === index ? { ...entry, [field]: value } : entry) }));
  }
  return <details className="assistant-memory-editor"><summary>本机创作记忆 · {memory.entries.length} / {ASSISTANT_MEMORY_LIMIT}</summary>
    <p>记录角色、服装和偏好，编辑后点保存生效。仅保存在当前浏览器；保存并启用后，随每次助手请求作为参考发送，当前需求优先。</p>
    <label className="assistant-memory-enable"><input type="checkbox" checked={memory.enabled} disabled={disabled && !memory.enabled} onChange={(event) => {
      const enabled = event.target.checked;
      try {
        if (enabled) setMemory(saveCreativeMemoryState({ ...memory, enabled: true }));
        else {
          let saved: CreativeMemoryState = { enabled: false, entries: [] };
          try { saved = readCreativeMemoryState(); } catch { /* Disabling also recovers malformed storage. */ }
          saveCreativeMemoryState({ ...saved, enabled: false });
          setMemory((current) => ({ ...current, enabled: false }));
        }
        setNotice(enabled ? "创作记忆已保存并启用。" : "创作记忆已关闭，之后的请求不会携带记忆。");
      }
      catch (error) { setNotice(error instanceof Error ? error.message : "保存失败。"); }
    }} />将已保存的创作记忆用于后续请求</label>
    {memory.entries.map((entry, index) => <fieldset key={index} disabled={disabled}><legend>记忆 {index + 1}</legend><input aria-label={`创作记忆 ${index + 1} 标题`} value={entry.title} maxLength={80} placeholder="角色、场景或偏好名称" onChange={(event) => update(index, "title", event.target.value)} /><textarea aria-label={`创作记忆 ${index + 1} 内容`} value={entry.text} maxLength={500} rows={3} placeholder="如：角色的名字、固定穿搭、希望保持的特点" onChange={(event) => update(index, "text", event.target.value)} /><button type="button" onClick={() => setMemory((current) => ({ ...current, entries: current.entries.filter((_, at) => at !== index) }))}>移除此条</button></fieldset>)}
    <div><button type="button" disabled={disabled || memory.entries.length >= ASSISTANT_MEMORY_LIMIT} onClick={() => setMemory((current) => ({ ...current, entries: [...current.entries, { title: "", text: "" }] }))}>添加记忆</button><button type="button" disabled={disabled} onClick={() => { try { setMemory(saveCreativeMemoryState(memory)); setNotice("创作记忆已保存。"); } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败。"); } }}>保存记忆</button><button type="button" onClick={() => { try { clearCreativeMemoryState(); setMemory({ enabled: false, entries: [] }); setNotice("本机创作记忆已清空。"); } catch { setNotice("清空失败，请检查浏览器存储权限。"); } }}>清空全部</button></div>
    {notice && <p role="status">{notice}</p>}
  </details>;
}
