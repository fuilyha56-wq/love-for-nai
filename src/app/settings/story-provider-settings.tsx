"use client";

import { useEffect, useState } from "react";
import { BookOpen, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { PublicStoryProvider } from "@/lib/story-providers";

type Account = { tier?: number; active?: boolean; expiresAt?: number; anlas?: number; contextTokens?: number; priority?: number; nextRefillAt?: number; banStatus?: string };
type ProviderResult = { items?: PublicStoryProvider[]; item?: PublicStoryProvider; message?: string };

const tierName: Record<number, string> = { 0: "Free", 1: "Tablet", 2: "Scroll", 3: "Opus" };

function formatDate(value?: number) {
  if (!value) return "未提供";
  const timestamp = value < 1e11 ? value * 1000 : value;
  return new Date(timestamp).toLocaleString("zh-CN");
}

export default function StoryProviderSettings() {
  const [items, setItems] = useState<PublicStoryProvider[]>([]);
  const [accounts, setAccounts] = useState<Record<string, Account>>({});
  const [kind, setKind] = useState<"openai" | "novelai">("openai");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/story-providers", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as ProviderResult;
        if (!response.ok) throw new Error(result.message || "读取模型源失败");
        setItems(result.items || []);
      }).catch((error) => { if (error.name !== "AbortError") setMessage(error.message); });
    return () => controller.abort();
  }, []);

  function resetForm() {
    setName(""); setBaseUrl(""); setModel(""); setKey(""); setEditingId("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/story-providers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId || undefined, kind, name, model, baseUrl, key }),
      });
      const result = await response.json() as ProviderResult;
      if (!response.ok || !result.item) throw new Error(result.message || "保存失败");
      setItems((current) => [result.item!, ...current.filter((item) => item.id !== result.item?.id)]);
      resetForm();
      setMessage("模型源已保存，可以在故事工作台选用。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("删除此模型源？使用它的故事需要重新选择模型。")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/story-providers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = await response.json() as ProviderResult;
      if (!response.ok) throw new Error(result.message || "删除失败");
      setItems((current) => current.filter((item) => item.id !== id));
      setAccounts((current) => { const next = { ...current }; delete next[id]; return next; });
      if (editingId === id) resetForm();
      setMessage("模型源已删除。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }

  async function readAccount(id: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/story-providers/${id}/account`, { cache: "no-store" });
      const result = await response.json() as Account & { message?: string };
      if (!response.ok) throw new Error(result.message || "账号读取失败");
      setAccounts((current) => ({ ...current, [id]: result }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "账号读取失败"); }
    finally { setBusy(false); }
  }

  return (
    <article className="panel rounded-md p-5 sm:p-6" id="story-providers">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--rose)_10%,transparent)] text-[var(--rose)]"><BookOpen size={18} /></span>
        <div><p className="text-[10px] font-bold text-[var(--rose)]">STORY · 模型源</p><h2 className="mt-1 text-base font-semibold">小说生成模型</h2><p className="mt-1 text-xs text-[var(--muted)]">可选用登录账号的 NewAPI 模型，也可导入自己的接口或 NovelAI 持久 Key。</p></div>
      </div>
      {message && <p role="status" className="mt-4 rounded border border-[var(--line)] bg-[var(--surface)] p-3 text-xs">{message}</p>}
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form onSubmit={(event) => void submit(event)} className="min-w-0 space-y-3 border-t border-[var(--line)] pt-4">
          <div className="flex items-center gap-2"><Plus size={16} className="text-[var(--rose)]" /><b className="text-sm">{editingId ? "编辑模型源" : "导入模型源"}</b></div>
          <label className="block text-xs font-semibold">来源
            <select value={kind} onChange={(event) => { setKind(event.target.value as "openai" | "novelai"); setModel(event.target.value === "novelai" ? "llama-3-erato-v1" : ""); }} className="field mt-1 w-full px-3 py-2 text-sm">
              <option value="openai">OpenAI 兼容 API</option><option value="novelai">NovelAI 官方持久 Key</option>
            </select>
          </label>
          <label className="block text-xs font-semibold">显示名称<input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "novelai" ? "我的 NovelAI Key" : "我的文本模型"} className="field mt-1 w-full px-3 py-2 text-sm" /></label>
          {kind === "openai" && <label className="block text-xs font-semibold">API Base URL<input required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" className="field mt-1 w-full px-3 py-2 text-sm" /></label>}
          <label className="block text-xs font-semibold">模型 ID
            {kind === "novelai" ? <select value={model} onChange={(event) => setModel(event.target.value)} className="field mt-1 w-full px-3 py-2 text-sm"><option value="llama-3-erato-v1">Erato</option><option value="kayra-v1">Kayra</option></select> : <input required maxLength={120} value={model} onChange={(event) => setModel(event.target.value)} placeholder="上游真实模型 ID" className="field mt-1 w-full px-3 py-2 text-sm" />}
          </label>
          <label className="block text-xs font-semibold">{kind === "novelai" ? "NovelAI 持久 Key" : "API Key"}
            <input required={!editingId} type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder={editingId ? "留空则保留原密钥" : "输入密钥"} className="field mt-1 w-full px-3 py-2 text-sm" />
          </label>
          <div className="flex gap-2"><button disabled={busy} type="submit" className="h-9 rounded bg-[var(--rose)] px-4 text-xs font-semibold text-white disabled:opacity-50">{editingId ? "保存修改" : "导入模型"}</button>{editingId && <button type="button" onClick={resetForm} className="h-9 rounded border border-[var(--line)] px-3 text-xs">取消编辑</button>}</div>
        </form>
        <div className="min-w-0 space-y-3 border-t border-[var(--line)] pt-4">
          <b className="block text-sm">已导入 {items.length} 个模型源</b>
          {!items.length && <p className="text-xs text-[var(--muted)]">还没有导入。NewAPI 可用模型无需手动导入。</p>}
          {items.map((item) => {
            const account = accounts[item.id];
            return <div key={item.id} className="min-w-0 rounded border border-[var(--line)] bg-[var(--surface)] p-3">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><b className="block truncate text-sm">{item.name}</b><span className="text-[11px] text-[var(--muted)]">{item.kind === "novelai" ? "NovelAI 官方" : "自定义接口"} · {item.model}</span></div><KeyRound size={15} className="shrink-0 text-[var(--rose)]" /></div>
              <p className="mt-1 truncate text-[10px] text-[var(--muted)]">{item.kind === "novelai" ? "官方直连" : item.baseUrl} · 密钥已保存</p>
              {account && <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--line)] pt-3 text-xs">
                <div><dt className="text-[var(--muted)]">订阅等级</dt><dd>{tierName[account.tier ?? -1] || "未知"} · {account.active === false ? "已停用" : "有效"}</dd></div>
                <div><dt className="text-[var(--muted)]">Anlas</dt><dd>{account.anlas?.toLocaleString("zh-CN") ?? "未提供"}</dd></div>
                <div><dt className="text-[var(--muted)]">有效至</dt><dd>{formatDate(account.expiresAt)}</dd></div>
                <div><dt className="text-[var(--muted)]">优先级 / 上下文</dt><dd>{account.priority ?? "--"} / {account.contextTokens ?? "--"}</dd></div>
                <div><dt className="text-[var(--muted)]">下次补充</dt><dd>{formatDate(account.nextRefillAt)}</dd></div>
                <div><dt className="text-[var(--muted)]">账号状态</dt><dd>{account.banStatus || "未提供"}</dd></div>
              </dl>}
              <div className="mt-3 flex gap-2 border-t border-[var(--line)] pt-3">
                {item.kind === "novelai" && <button type="button" disabled={busy} onClick={() => void readAccount(item.id)} className="flex items-center gap-1 text-xs text-[var(--rose)] disabled:opacity-50"><RefreshCw size={13} />读取账号</button>}
                <button type="button" className="text-xs text-[var(--rose)]" onClick={() => { setEditingId(item.id); setKind(item.kind); setName(item.name); setModel(item.model); setBaseUrl(item.baseUrl); setKey(""); }}>编辑</button>
                <button type="button" disabled={busy} aria-label={`删除${item.name}`} onClick={() => void remove(item.id)} className="ml-auto text-[var(--muted)] hover:text-[var(--rose)] disabled:opacity-50"><Trash2 size={15} /></button>
              </div>
            </div>;
          })}
        </div>
      </div>
    </article>
  );
}