"use client";

import { WorkspaceNav } from "@/app/workspace-nav";
import { GallerySubmitDialog, type GallerySubmitForm } from "@/app/gallery-submit";
import { PublicHeader } from "@/app/public-header";
import { ArrowRight, BriefcaseBusiness, Clock3, ExternalLink, Send, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

 type Submission = {
  id: string; title: string; authorName: string; status: "pending" | "approved" | "rejected" | "withdrawn";
  reviewNote?: string; submittedAt: string; imageUrl: string;
};
const statusLabels = { pending: "待审核", approved: "已通过", rejected: "已拒绝", withdrawn: "已撤回" } as const;

export default function StudioPage() {
  const [items, setItems] = useState<Submission[]>([]);
  const [form, setForm] = useState<GallerySubmitForm | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/gallery/mine", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "投稿读取失败");
      setItems(Array.isArray(result.items) ? result.items : []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "投稿读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        if (!cancelled) setAuthenticated(result.authenticated === true);
      })
      .catch(() => {
        if (!cancelled) setAuthenticated(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (authenticated === true) void load();
      else if (authenticated === false) setLoading(false);
    });
  }, [authenticated, load]);

  async function action(id: string, actionName: "resubmit" | "withdraw") {
    const response = await fetch("/api/gallery/mine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: actionName }) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.message || "操作失败"); return; }
    setMessage(actionName === "resubmit" ? "已重新提交，等待审核。" : "投稿已撤回。");
    await load();
  }

  return <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
    <PublicHeader current="gallery" actionLabel="进入图像工作台" actionHref="/image" extraActions={<Link href="/gallery" className="hidden text-xs font-semibold text-[var(--muted)] sm:flex">浏览广场</Link>} />
    <WorkspaceNav />
    <section className="mx-auto max-w-7xl space-y-6 p-4 sm:p-7">
      {message && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
      {authenticated === false && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm"><span className="text-[var(--muted)]">登录后才能提交和管理自己的投稿。</span><Link href="/sign-in?next=%2Fstudio" className="inline-flex h-9 items-center rounded bg-[var(--rose)] px-3 font-semibold text-white">登录后继续</Link></div>}
      <div className="grid gap-4 md:grid-cols-3">
        <article className="rounded-lg border border-[var(--line)] bg-white p-5"><BriefcaseBusiness size={19} className="text-[var(--rose)]" /><p className="mt-3 text-xs text-[var(--muted)]">我的投稿</p><p className="mt-1 text-2xl font-semibold">{loading ? "…" : items.length}</p><p className="mt-2 text-xs text-[var(--muted)]">从历史页或本页提交 NAI 作品</p></article>
        <article className="rounded-lg border border-[var(--line)] bg-white p-5"><Clock3 size={19} className="text-[var(--rose)]" /><p className="mt-3 text-xs text-[var(--muted)]">等待审核</p><p className="mt-1 text-2xl font-semibold">{items.filter((item) => item.status === "pending").length}</p><p className="mt-2 text-xs text-[var(--muted)]">新投稿默认不会直接公开</p></article>
        <article className="rounded-lg border border-[var(--line)] bg-white p-5"><UserRound size={19} className="text-[var(--rose)]" /><p className="mt-3 text-xs text-[var(--muted)]">创作者资料</p><p className="mt-1 font-semibold">使用站内个人资料</p><Link href="/profile" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--rose)]">编辑显示名称 <ArrowRight size={13} /></Link></article>
      </div>
      <section className="rounded-lg border border-[var(--line)] bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.14em] text-[var(--rose)]">CREATOR PROFILE</p><h1 className="mt-2 text-xl font-semibold">创作者入口</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">作品会先进入人工审核。通过后才会出现在公开图片广场、详情页和原图接口；被拒绝或撤回的投稿可以在下方重新提交。</p></div>{authenticated === true ? <button type="button" onClick={() => setForm({ title: "", authorName: "", rating: "general", source: "local", tags: "", exposeParameters: true })} className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white"><Send size={15} />提交新作品</button> : <Link href="/sign-in?next=%2Fstudio" className="flex h-10 items-center gap-2 rounded border border-[var(--line)] bg-[var(--panel)] px-4 text-sm font-semibold text-[var(--rose)]"><Send size={15} />登录后投稿</Link>}</div>
      </section>
      <section className="rounded-lg border border-[var(--line)] bg-white p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="font-semibold">我的投稿状态</h2><span className="text-xs text-[var(--muted)]">{items.length} 件</span></div>
        {loading ? <p className="py-12 text-center text-sm text-[var(--muted)]">正在读取投稿…</p> : items.length ? <div className="mt-4 space-y-2">{items.map((item) => <article key={item.id} className="flex flex-wrap items-center gap-3 rounded border border-[var(--line)] px-3 py-3"><img src={item.imageUrl} alt="" className="h-14 w-14 rounded object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.authorName} · {new Date(item.submittedAt).toLocaleString("zh-CN")}</p>{item.reviewNote && <p className="mt-1 text-xs text-amber-800">审核备注：{item.reviewNote}</p>}</div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === "approved" ? "bg-emerald-50 text-emerald-700" : item.status === "rejected" ? "bg-red-50 text-red-700" : item.status === "withdrawn" ? "bg-stone-100 text-stone-600" : "bg-amber-50 text-amber-700"}`}>{statusLabels[item.status]}</span>{item.status === "rejected" || item.status === "withdrawn" ? <button type="button" onClick={() => action(item.id, "resubmit")} className="text-xs font-semibold text-[var(--rose)]">重新提交</button> : item.status === "pending" || item.status === "approved" ? <button type="button" onClick={() => action(item.id, "withdraw")} className="text-xs font-semibold text-[var(--muted)]">撤回</button> : null}{item.status === "approved" && <Link href={`/gallery/${item.id}`} className="text-[var(--rose)]" aria-label="查看已通过作品"><ExternalLink size={15} /></Link>}</article>)}</div> : <p className="py-12 text-center text-sm text-[var(--muted)]">还没有投稿，先从历史页选择一张作品。</p>}
      </section>
    </section>
    {form && <GallerySubmitDialog form={form} onChange={setForm} onClose={() => setForm(null)} onPublished={() => { setForm(null); setMessage("已提交审核，审核通过后会公开展示。让我们看看你的作品。 "); void load(); }} />}
  </main>;
}
