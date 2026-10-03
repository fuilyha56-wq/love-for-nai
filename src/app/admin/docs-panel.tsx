"use client";

import { AlertTriangle, BookOpen, ExternalLink, FilePlus2, Save, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownView } from "@/app/markdown";

export type AdminDocument = {
  id: string;
  slug: string;
  title: string;
  category: string;
  summary: string;
  content: string;
  status: "draft" | "published";
  sortOrder: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  builtIn?: boolean;
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";
type Draft = Pick<AdminDocument, "slug" | "title" | "category" | "summary" | "content" | "sortOrder">;

const emptyDraft: Draft = { slug: "new-document", title: "新文档", category: "未分类", summary: "", content: "# 新文档\n\n开始编辑……", sortOrder: 100 };

function toDraft(item: AdminDocument): Draft {
  return { slug: item.slug, title: item.title, category: item.category, summary: item.summary, content: item.content, sortOrder: item.sortOrder };
}

export default function DocsPanel() {
  const [items, setItems] = useState<AdminDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const versionRef = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const initialisingRef = useRef(true);
  const latestDraftRef = useRef(draft);

  const selected = items.find((item) => item.id === selectedId) || null;
  const selectedRef = useRef<AdminDocument | null>(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { latestDraftRef.current = draft; }, [draft]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/docs", { cache: "no-store" });
      const result = (await response.json()) as { items?: AdminDocument[]; message?: string };
      if (!response.ok) throw new Error(result.message || "文档读取失败");
      const next = Array.isArray(result.items) ? result.items : [];
      setItems(next);
      const nextSelected = next.find((item) => item.id === selectedIdRef.current) || next[0] || null;
      setSelectedId(nextSelected?.id || null);
      selectedIdRef.current = nextSelected?.id || null;
      if (nextSelected) {
        setDraft(toDraft(nextSelected));
        latestDraftRef.current = toDraft(nextSelected);
        versionRef.current = nextSelected.version;
        setSaveState("saved");
      }
      initialisingRef.current = false;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文档读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);

  const save = useCallback(async (): Promise<AdminDocument | null> => {
    const item = selectedRef.current;
    if (!item) return null;
    setSaveState("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/docs/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...latestDraftRef.current, version: versionRef.current }),
      });
      const result = (await response.json()) as { item?: AdminDocument; message?: string };
      if (response.status === 409) {
        if (result.item) setItems((current) => current.map((entry) => entry.id === result.item!.id ? result.item! : entry));
        setSaveState("conflict");
        setMessage(result.message || "其他管理员已经更新了这篇文档");
        return null;
      }
      if (!response.ok || !result.item) throw new Error(result.message || "保存失败");
      setItems((current) => current.map((entry) => entry.id === result.item!.id ? result.item! : entry));
      versionRef.current = result.item.version;
      setSaveState("saved");
      return result.item;
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "保存失败");
      return null;
    }
  }, []);

  useEffect(() => {
    if (initialisingRef.current || saveState !== "dirty" || !selectedId) return;
    const timer = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, save, saveState, selectedId]);

  function select(item: AdminDocument) {
    selectedIdRef.current = item.id;
    setSelectedId(item.id);
    setDraft(toDraft(item));
    latestDraftRef.current = toDraft(item);
    versionRef.current = item.version;
    setSaveState("saved");
    setMessage("");
  }

  function edit<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveState("dirty");
    setMessage("");
  }

  async function create() {
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...emptyDraft, slug: `new-document-${Date.now()}` }),
      });
      const result = (await response.json()) as { item?: AdminDocument; message?: string };
      if (!response.ok || !result.item) throw new Error(result.message || "创建失败");
      setItems((current) => [...current, result.item!]);
      select(result.item);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function publish() {
    const item = selectedRef.current;
    if (!item) return;
    if (saveState === "dirty" && !(await save())) return;
    const latest = selectedRef.current;
    if (!latest) return;
    setSaveState("saving");
    try {
      const response = await fetch(`/api/admin/docs/${encodeURIComponent(latest.id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: versionRef.current }),
      });
      const result = (await response.json()) as { item?: AdminDocument; message?: string };
      if (response.status === 409) {
        setSaveState("conflict");
        setMessage(result.message || "发布冲突：服务器版本已变化");
        return;
      }
      if (!response.ok || !result.item) throw new Error(result.message || "发布失败");
      setItems((current) => current.map((entry) => entry.id === result.item!.id ? result.item! : entry));
      versionRef.current = result.item.version;
      setSaveState("saved");
      setMessage("文档已发布，公开页面立即生效");
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "发布失败");
    }
  }

  async function remove() {
    const item = selectedRef.current;
    if (!item || item.builtIn || !window.confirm(`确定删除「${item.title}」？`)) return;
    const response = await fetch(`/api/admin/docs/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    const result = (await response.json()) as { message?: string };
    if (!response.ok) { setMessage(result.message || "删除失败"); return; }
    const remaining = items.filter((entry) => entry.id !== item.id);
    setItems(remaining);
    const next = remaining[0];
    if (next) select(next); else { setSelectedId(null); selectedIdRef.current = null; }
  }

  const stateLabel: Record<SaveState, string> = { idle: "", dirty: "未保存", saving: "保存中…", saved: "已保存", conflict: "版本冲突", error: "保存失败" };
  return (
    <section className="space-y-4" aria-label="文档管理">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-base font-semibold"><BookOpen size={18} className="text-[var(--rose)]" />文档管理</h2><p className="mt-1 text-xs text-[var(--muted)]">在线编辑 Markdown，停止输入 700ms 后自动保存草稿。</p></div>
        <button type="button" disabled={creating} onClick={() => void create()} className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm font-semibold text-[var(--rose)] hover:border-[var(--rose)] disabled:opacity-60"><FilePlus2 size={15} />新建文档</button>
      </div>
      {message && <p className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${saveState === "conflict" || saveState === "error" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}><AlertTriangle size={15} />{message}</p>}
      {saveState === "conflict" && selected && <div className="flex flex-wrap items-center gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"><span>请重新读取服务器版本后再继续编辑，避免覆盖其他管理员的修改。</span><button type="button" onClick={() => { select(selected); setSaveState("saved"); setMessage("已放弃本地修改并载入服务器版本"); }} className="font-semibold underline">载入服务器版本</button></div>}
      <div className="grid min-h-[34rem] gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-2">
          <div className="mb-2 flex items-center justify-between px-2"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">全部文档</span><span className="text-[10px] text-[var(--muted)]">{items.length}</span></div>
          <div className="space-y-1">{items.map((item) => <button key={item.id} type="button" onClick={() => select(item)} className={`w-full rounded px-2.5 py-2 text-left ${item.id === selectedId ? "bg-[var(--rose)] text-white" : "hover:bg-[var(--surface-muted)]"}`}><span className="block truncate text-xs font-semibold">{item.title}</span><span className={`mt-0.5 block text-[10px] ${item.id === selectedId ? "text-white/75" : "text-[var(--muted)]"}`}>{item.category} · {item.status === "published" ? "已发布" : "草稿"}</span></button>)}</div>
          {!loading && !items.length && <p className="px-2 py-8 text-center text-xs text-[var(--muted)]">暂无文档</p>}
        </aside>
        {selected ? <div className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs text-[var(--muted)]"><span className={`rounded-full px-2 py-0.5 font-semibold ${selected.status === "published" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{selected.status === "published" ? "已发布" : "草稿"}</span><span>版本 {selected.version}</span><span>{stateLabel[saveState]}</span></div><div className="flex items-center gap-2"><a href={`/docs#${selected.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded border border-[var(--line)] px-2.5 text-xs font-semibold hover:border-[var(--rose)]"><ExternalLink size={13} />公开文档</a>{!selected.builtIn && <button type="button" onClick={() => void remove()} className="inline-flex h-8 items-center gap-1 rounded border border-red-200 px-2.5 text-xs font-semibold text-red-700 hover:bg-red-50"><Trash2 size={13} />删除</button>}</div></div>
          <div className="grid gap-3 sm:grid-cols-2"><input value={draft.title} onChange={(event) => edit("title", event.target.value)} placeholder="文档标题" className="field h-10 px-3 text-sm font-semibold" /><input value={draft.slug} onChange={(event) => edit("slug", event.target.value)} placeholder="slug" className="field h-10 px-3 font-mono text-xs" /><input value={draft.category} onChange={(event) => edit("category", event.target.value)} placeholder="分类" className="field h-10 px-3 text-sm" /><input value={draft.summary} onChange={(event) => edit("summary", event.target.value)} placeholder="摘要" className="field h-10 px-3 text-sm sm:col-span-1" /></div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2"><div><p className="mb-1.5 text-xs font-semibold text-[var(--muted)]">Markdown 编辑</p><textarea value={draft.content} onChange={(event) => edit("content", event.target.value)} className="field min-h-[23rem] w-full resize-y p-3 font-mono text-xs leading-5" spellCheck={false} /></div><div><p className="mb-1.5 text-xs font-semibold text-[var(--muted)]">实时预览</p><div className="min-h-[23rem] rounded border border-[var(--line)] bg-[var(--surface)] p-4"><MarkdownView content={draft.content} /></div></div></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-3"><p className="text-[10px] text-[var(--muted)]">更新于 {new Date(selected.updatedAt).toLocaleString("zh-CN")} · {selected.updatedBy}</p><div className="flex gap-2"><button type="button" disabled={saveState === "saving" || saveState === "saved"} onClick={() => void save()} className="inline-flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-xs font-semibold hover:border-[var(--rose)] disabled:opacity-50"><Save size={14} />保存草稿</button><button type="button" disabled={saveState === "saving"} onClick={() => void publish()} className="inline-flex h-9 items-center gap-1.5 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white disabled:opacity-50"><Send size={14} />发布</button></div></div>
        </div> : <div className="grid place-items-center rounded-lg border border-dashed border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--muted)]">选择或新建一篇文档</div>}
      </div>
    </section>
  );
}

export { DocsPanel };
