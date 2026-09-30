"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, Filter, Pin, Plus, Redo2, RotateCcw, Search, Trash2, Undo2, X } from "lucide-react";
import type { FixedPromptTag, PromptTarget, ReplicaPromptConfig, ReplicaVariant } from "@/lib/replica-prompt";
import { splitPromptTags } from "@/lib/replica-prompt";

export function ReplicaPromptModal({ variant, title, children, onClose, className = "", footer, headerActions, icon }: {
  variant: ReplicaVariant; title: string; children: ReactNode; onClose: () => void; className?: string; footer?: ReactNode; headerActions?: ReactNode; icon?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (!node.open) node.showModal();
    return () => { if (node.open) node.close(); };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} data-variant={variant} className={"replica-prompt-dialog " + className}
    aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <header><div className="replica-dialog-title">{icon}<b>{title}</b></div>
      {headerActions && <div className="replica-dialog-header-actions">{headerActions}</div>}
      <button type="button" className="replica-dialog-close" onClick={onClose} aria-label={"关闭" + title}><X size={20} /></button></header>
    <div className="replica-dialog-body">{children}</div>
    {footer && <footer>{footer}</footer>}
  </dialog>, document.body);
}

function newEntry(target: PromptTarget): FixedPromptTag {
  return { id: crypto.randomUUID(), name: "", content: "", target, position: "prefix", weight: 1, enabled: true, category: "根目录" };
}
export function ReplicaFixedTagsDialog({ variant, config, onChange, onClose }: {
  variant: ReplicaVariant; config: ReplicaPromptConfig; onChange: (next: ReplicaPromptConfig) => void; onClose: () => void;
}) {
  const [negativeVisible, setNegativeVisible] = useState(true);
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [query, setQuery] = useState({ positive: "", negative: "" });
  const [editing, setEditing] = useState<FixedPromptTag | null>(null);
  const [libraryTarget, setLibraryTarget] = useState<PromptTarget | "all" | null>(null);
  const [past, setPast] = useState<FixedPromptTag[][]>([]);
  const [future, setFuture] = useState<FixedPromptTag[][]>([]);
  function commit(entries: FixedPromptTag[], library = config.library) {
    setPast((values) => [...values.slice(-39), config.fixedTags]);
    setFuture([]);
    onChange({ ...config, fixedTags: entries, library });
  }
  function undo() {
    if (!past.length) return;
    const entries = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([config.fixedTags, ...future]);
    onChange({ ...config, fixedTags: entries });
  }
  function redo() {
    if (!future.length) return;
    setPast([...past, config.fixedTags]);
    onChange({ ...config, fixedTags: future[0] });
    setFuture(future.slice(1));
  }
  return <>
    <ReplicaPromptModal variant={variant} title="管理固定词" onClose={onClose} className="replica-fixed-manager"
      icon={<span className="replica-dialog-pin"><Pin size={20} /></span>}
      headerActions={<>
        <button type="button" onClick={() => setNegativeVisible(!negativeVisible)}>{negativeVisible ? "→| 收起负向" : "←| 展开负向"}</button>
        <button type="button" onClick={undo} disabled={!past.length} aria-label="撤销固定词修改"><Undo2 size={18} /></button>
        <button type="button" onClick={redo} disabled={!future.length} aria-label="重做固定词修改"><Redo2 size={18} /></button>
        <button type="button" aria-label="仅显示已启用固定词" aria-pressed={enabledOnly} onClick={() => setEnabledOnly(!enabledOnly)}><Filter size={19} /></button>
      </>}
      footer={<><button type="button" className="replica-tonal" onClick={() => setLibraryTarget("all")}><BookOpen size={16} /> 打开词库</button><small>在各列顶部新建或从词库添加</small></>}>
      <div className={"replica-fixed-columns" + (!negativeVisible ? " is-single" : "")}>
        {(["positive", "negative"] as const).filter((target) => target !== "negative" || negativeVisible).map((target) => {
          const all = config.fixedTags.filter((entry) => entry.target === target);
          const visible = all.filter((entry) => (!enabledOnly || entry.enabled) && (entry.content + " " + entry.name).toLowerCase().includes(query[target].toLowerCase()));
          return <section key={target} aria-label={target === "positive" ? "正向固定词" : "负向固定词"}>
            <div className="replica-fixed-column-heading"><b>{target === "positive" ? "正向" : "负向"}固定词 · {all.filter((entry) => entry.enabled).length}/{all.length}</b>
              <div><button type="button" onClick={() => setEditing(newEntry(target))}><Plus size={16} /> 新建</button>
                <button type="button" onClick={() => setLibraryTarget(target)}><BookOpen size={15} /> 词库</button>
                <button type="button" disabled={!all.length} onClick={() => commit(config.fixedTags.map((entry) => entry.target === target ? { ...entry, enabled: !all.every((item) => item.enabled) } : entry))}>{all.every((entry) => entry.enabled) ? "全关" : "全开"}</button></div>
            </div>
            <label className="replica-fixed-search"><Search size={17} /><input aria-label={"搜索" + (target === "positive" ? "正向" : "负向") + "固定词"}
              placeholder={"搜索 " + (target === "positive" ? "正向" : "负向") + "固定词…"} value={query[target]} onChange={(event) => setQuery({ ...query, [target]: event.target.value })} /></label>
            <div className="replica-fixed-list">{visible.length ? visible.map((entry) => <article key={entry.id}>
              <input type="checkbox" aria-label={"启用固定词 " + (entry.name || entry.content)} checked={entry.enabled} onChange={() => commit(config.fixedTags.map((item) => item.id === entry.id ? { ...item, enabled: !item.enabled } : item))} />
              <button type="button" className="replica-fixed-entry" onClick={() => setEditing(entry)}><b>{entry.name || entry.content}</b><small>{entry.position === "prefix" ? "前缀" : "后缀"} · {entry.weight.toFixed(2)}x</small><p>{entry.content}</p></button>
              <button type="button" className="replica-danger" aria-label={"删除固定词 " + (entry.name || entry.content)} onClick={() => commit(config.fixedTags.filter((item) => item.id !== entry.id))}><Trash2 size={16} /></button>
            </article>) : <p className="replica-fixed-empty">{query[target] ? "没有匹配的固定词" : "暂无" + (target === "positive" ? "正向" : "负向") + "固定词"}</p>}</div>
          </section>;
        })}
      </div>
    </ReplicaPromptModal>
    {editing && <FixedTagEditor key={editing.id} variant={variant} entry={editing} categories={[...new Set(config.library.map((entry) => entry.category))]} onClose={() => setEditing(null)}
      onSave={(entry, saveToLibrary) => {
        const exists = config.fixedTags.some((item) => item.id === entry.id);
        const entries = exists ? config.fixedTags.map((item) => item.id === entry.id ? entry : item) : [...config.fixedTags, entry];
        const library = saveToLibrary ? [...config.library.filter((item) => item.id !== entry.id), entry] : config.library;
        commit(entries, library);
        setEditing(null);
      }} />}
    {libraryTarget && <ReplicaPromptModal variant={variant} title="固定词库" onClose={() => setLibraryTarget(null)} className="replica-library-dialog">
      {config.library.length ? <div className="replica-library-entries">{config.library.map((entry) => <article key={entry.id}>
        <button type="button" className="replica-fixed-entry" onClick={() => { commit([...config.fixedTags, { ...entry, id: crypto.randomUUID(), target: libraryTarget === "all" ? entry.target : libraryTarget }]); setLibraryTarget(null); }}>
          <b>{entry.name || entry.content}</b><small>{entry.category} · {entry.target === "positive" ? "正向" : "负向"}</small><p>{entry.content}</p><span>添加到固定词</span>
        </button>
        <button type="button" className="replica-danger" aria-label={"删除词库条目 " + (entry.name || entry.content)} onClick={() => onChange({ ...config, library: config.library.filter((item) => item.id !== entry.id) })}><Trash2 size={16} /></button>
      </article>)}</div> : <p className="replica-library-empty">暂无词库条目。添加固定词时勾选“同时保存到词库”。</p>}
    </ReplicaPromptModal>}
  </>;
}

function FixedTagEditor({ variant, entry, categories, onSave, onClose }: {
  variant: ReplicaVariant; entry: FixedPromptTag; categories: string[]; onSave: (entry: FixedPromptTag, saveToLibrary: boolean) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(entry);
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [tagMode, setTagMode] = useState(false);
  const contentTags = splitPromptTags(draft.content);
  return <ReplicaPromptModal variant={variant} title={entry.content ? "编辑固定词" : "添加"} onClose={onClose} className="replica-fixed-editor"
    footer={<><button type="button" onClick={onClose}>取消</button><button type="button" className="replica-primary" disabled={!draft.content.trim()} onClick={() => onSave({ ...draft, name: draft.name.trim(), content: draft.content.trim() }, saveToLibrary)}>保存</button></>}>
    <div className="replica-fixed-editor-grid">
      <div className="replica-fixed-editor-content">
        <label>名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="输入备注名称（可选）" /></label>
        <label className="replica-fixed-content-label"><span>内容<small>{contentTags.length}</small></span>
          {tagMode ? <div className="replica-fixed-content-tags">{contentTags.map((tag, index) => <span key={index}>{tag}<button type="button" aria-label={"移除 " + tag} onClick={() => setDraft({ ...draft, content: contentTags.filter((_, itemIndex) => itemIndex !== index).join(", ") })}><X size={13} /></button></span>)}<textarea aria-label="添加固定词标签" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} /></div>
            : <textarea aria-label="固定词内容" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="输入提示词内容，支持 NAI 语法" />}
        </label>
        <div className="replica-fixed-content-footer"><small>支持 NAI 语法增强／减弱权重、标签交替等</small><button type="button" aria-pressed={tagMode} onClick={() => setTagMode(!tagMode)}>{tagMode ? "Tag" : "Tᴛ"}</button></div>
      </div>
      <div className="replica-fixed-editor-options">
        <fieldset><legend>作用范围</legend><div className="replica-dialog-segments">{(["positive", "negative"] as const).map((target) => <button type="button" key={target} aria-pressed={draft.target === target} onClick={() => setDraft({ ...draft, target })}>{draft.target === target && <Check size={15} />}{target === "positive" ? "正向" : "负向"}</button>)}</div></fieldset>
        <fieldset><legend>位置</legend><div className="replica-dialog-segments">{(["prefix", "suffix"] as const).map((position) => <button type="button" key={position} aria-pressed={draft.position === position} onClick={() => setDraft({ ...draft, position })}>{draft.position === position && <Check size={15} />}{position === "prefix" ? "前缀" : "后缀"}</button>)}</div></fieldset>
        <label className="replica-weight-label">权重 <output>{draft.weight.toFixed(2)}x</output></label>
        <div className="replica-dialog-weight"><span>0.5</span><input type="range" min={0.5} max={2} step={0.05} aria-label="固定词权重" value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: Number(event.target.value) })} /><span>2.0</span><button type="button" aria-label="重置固定词权重" onClick={() => setDraft({ ...draft, weight: 1 })}><RotateCcw size={16} /></button></div>
        <label className="replica-enabled-control">已启用<input type="checkbox" role="switch" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /></label>
        <label>保存到类别<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{[...new Set(["根目录", ...categories])].map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="replica-save-library"><input type="checkbox" checked={saveToLibrary} onChange={(event) => setSaveToLibrary(event.target.checked)} /><span>同时保存到词库<small>方便日后在词库中重复使用</small></span></label>
      </div>
    </div>
  </ReplicaPromptModal>;
}
