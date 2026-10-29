"use client";

import { useState } from "react";
import type { AssistantConversationControl } from "@/app/ui/use-assistant-conversations";
import "./assistant-session-manager.css";

export function AssistantSessionManager({ control, disabled = false, onClose }: { control: AssistantConversationControl; disabled?: boolean; onClose: () => void }) {
  const [query, setQuery] = useState(""), [name, setName] = useState(""), [notice, setNotice] = useState("");
  const blocked = disabled || control.pending;
  const active = control.sessions.find((item) => item.id === control.activeId);
  const sessions = control.sessions.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const run = async (task: () => Promise<void>, success: string) => { setNotice(""); try { await task(); setNotice(success); setName(""); } catch { /* The control exposes the server error. */ } };
  return <section className="mobile-assistant-session-manager" aria-label="助手会话管理">
    <header><b>助手会话</b><button type="button" onClick={onClose} aria-label="关闭助手会话管理">关闭</button></header>
    <p>每个会话独立保留上下文和标签池。当前：{active?.title || "默认会话"}</p>
    <input type="search" aria-label="搜索助手会话" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话名称" />
    <ul>{sessions.map((item) => <li key={item.id}><button type="button" aria-current={item.id === control.activeId ? "true" : undefined} disabled={blocked} onClick={() => { control.select(item.id); onClose(); }}><strong>{item.title}</strong>{item.id === control.activeId && <span>当前</span>}</button></li>)}</ul>
    {!sessions.length && <p>{control.pending ? "正在恢复会话…" : "没有匹配的会话。"}</p>}
    <label>新建或重命名<input aria-label="助手会话名称" value={name} maxLength={80} placeholder={active?.title || "新会话名称"} onChange={(event) => setName(event.target.value)} /></label>
    <div><button type="button" disabled={blocked} onClick={() => void run(() => control.create(name.trim() || "新会话"), "新会话已创建。")}>新建会话</button><button type="button" disabled={blocked || !name.trim()} onClick={() => void run(() => control.rename(name), "会话已重命名。")}>重命名当前</button><button type="button" disabled={blocked} onClick={() => void run(control.remove, control.activeId === "default" ? "默认会话已清空。" : "会话已删除。")}>{control.activeId === "default" ? "清空默认会话" : "删除当前会话"}</button><button type="button" disabled={blocked} onClick={() => void run(control.refresh, "会话列表已刷新。")}>刷新</button></div>
    {(control.error || notice) && <p role="status">{control.error || notice}</p>}
  </section>;
}
