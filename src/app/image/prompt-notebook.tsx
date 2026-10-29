"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { appendPromptFragment, mergePromptNotes, parsePromptNotebook, PROMPT_NOTEBOOK_KEY, PROMPT_NOTEBOOK_LIMIT, type PromptNote } from "@/lib/prompt-notebook";
import "./prompt-notebook.css";

type Props = {
  prompt: string;
  negativePrompt?: string;
  onPromptChange: (value: string) => void;
  onNegativePromptChange?: (value: string) => void;
};

export default function PromptNotebook({ prompt, negativePrompt = "", onPromptChange, onNegativePromptChange }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const importer = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<PromptNote[]>([]);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [positive, setPositive] = useState("");
  const [negative, setNegative] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, [open]);

  const closeNotebook = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };

  const readNotes = () => {
    try {
      const saved = localStorage.getItem(PROMPT_NOTEBOOK_KEY);
      const loaded = saved ? parsePromptNotebook(JSON.parse(saved)) : [];
      setNotes(loaded);
      return loaded;
    } catch {
      setNotice("本机笔记暂时无法读取。请检查浏览器存储或导入备份；原有数据未被覆盖。");
      return null;
    }
  };

  const persist = (next: PromptNote[]) => {
    try {
      localStorage.setItem(PROMPT_NOTEBOOK_KEY, JSON.stringify({ version: 1, notes: next }));
      setNotes(next);
      return true;
    } catch {
      setNotice("保存失败，浏览器存储可能已满或被禁用。请先导出笔记备份。");
      return false;
    }
  };

  const begin = () => {
    setNotice("");
    readNotes();
    setEditingId(null);
    setTitle("");
    setPositive(prompt);
    setNegative(negativePrompt);
    setOpen(true);
  };

  const save = () => {
    const latest = readNotes();
    if (!latest) return;
    try {
      const [note] = parsePromptNotebook([{ id: editingId || crypto.randomUUID(), title: title.trim() || positive.trim().slice(0, 40) || "反向提示词", positive, negative, updatedAt: Date.now() }]);
      const next = editingId ? latest.map((item) => item.id === editingId ? note : item) : [note, ...latest];
      if (editingId && !latest.some((item) => item.id === editingId)) throw new Error("这条笔记已在其他窗口删除，请重新保存。");
      if (next.length > PROMPT_NOTEBOOK_LIMIT) throw new Error("最多保存 200 条笔记，请先导出或整理。");
      if (persist(next)) { setEditingId(note.id); setNotice("已保存到本机笔记本。"); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败。"); }
  };

  const insert = (note: PromptNote, replace: boolean) => {
    onPromptChange(replace ? note.positive : appendPromptFragment(prompt, note.positive));
    if (onNegativePromptChange) onNegativePromptChange(replace ? note.negative : appendPromptFragment(negativePrompt, note.negative));
    closeNotebook();
  };

  const exportNotes = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, notes }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "lfn-prompt-notebook.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleNotes = notes.filter((note) => `${note.title}\n${note.positive}\n${note.negative}`.toLocaleLowerCase().includes(normalizedQuery));

  return <>
    <button ref={trigger} type="button" className="prompt-notebook-trigger" title="提示词笔记本" aria-label="打开提示词笔记本" onClick={begin}>笔记本</button>
    {open && createPortal(<dialog ref={dialog} className="prompt-notebook-dialog" aria-labelledby="prompt-notebook-title" role="dialog" aria-modal="true" onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }} onCancel={(event) => { event.stopPropagation(); closeNotebook(); }} onClick={(event) => { if (event.target === event.currentTarget) closeNotebook(); }}>
      <header><div><h2 id="prompt-notebook-title">提示词笔记本</h2><p>收藏片段或整组提示词，保留权重与换行，仅存于当前浏览器。</p></div><button type="button" aria-label="关闭提示词笔记本" onClick={() => closeNotebook()}>关闭</button></header>
      <div className="prompt-notebook-body">
        <section className="prompt-notebook-draft" aria-label="编辑提示词笔记">
          <label>标题<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="如：角色服装、夜景光线" /></label>
          <label>正向提示词<textarea value={positive} maxLength={20_000} onChange={(event) => setPositive(event.target.value)} rows={4} /></label>
          {onNegativePromptChange && <label>反向提示词<textarea value={negative} maxLength={20_000} onChange={(event) => setNegative(event.target.value)} rows={2} /></label>}
          <div className="prompt-notebook-actions"><button type="button" onClick={save}>{editingId ? "保存修改" : "收藏当前提示词"}</button><button type="button" onClick={() => { setEditingId(null); setTitle(""); setPositive(prompt); setNegative(negativePrompt); setNotice(""); }}>从当前提示词新建</button></div>
        </section>
        <section className="prompt-notebook-library" aria-label="已收藏的提示词">
          <input type="search" aria-label="搜索提示词笔记" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索标题或内容 (${notes.length}/200)`} />
          <div className="prompt-notebook-actions"><button type="button" onClick={() => importer.current?.click()}>导入</button><button type="button" onClick={exportNotes} disabled={!notes.length}>导出备份</button></div>
          <input ref={importer} type="file" accept=".json,application/json" hidden onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (!file) return;
            try {
              if (file.size > 33_554_432) throw new Error("笔记文件不能超过 32 MB。");
              const incoming = parsePromptNotebook(JSON.parse(await file.text()));
              const latest = readNotes(); if (!latest) return;
              const next = mergePromptNotes(latest, incoming, () => crypto.randomUUID());
              if (persist(next)) setNotice(`已导入 ${next.length - latest.length} 条笔记，重复内容已跳过。`);
            } catch (error) { setNotice(error instanceof Error ? error.message : "导入失败。"); }
          }} />
          {!visibleNotes.length && <p>{notes.length ? "没有匹配的笔记。" : "还没有笔记，可以先收藏当前提示词。"}</p>}
          {visibleNotes.map((note) => <article key={note.id}><strong>{note.title}</strong><pre>{note.positive || `反向：${note.negative}`}</pre>{note.negative && note.positive && <small>含反向提示词</small>}<div className="prompt-notebook-actions">
            <button type="button" onClick={() => insert(note, false)}>插入</button><button type="button" onClick={() => insert(note, true)}>替换</button>
            <button type="button" onClick={() => { setEditingId(note.id); setTitle(note.title); setPositive(note.positive); setNegative(note.negative); setNotice(""); }}>编辑</button>
            <button type="button" onClick={() => { const latest = readNotes(); if (latest && persist(latest.filter((item) => item.id !== note.id))) { if (editingId === note.id) setEditingId(null); setNotice("笔记已删除。"); } }}>删除</button>
          </div></article>)}
        </section>
      </div>
      {notice && <p className="prompt-notebook-notice" role="status">{notice}</p>}
    </dialog>, document.body)}
  </>;
}
