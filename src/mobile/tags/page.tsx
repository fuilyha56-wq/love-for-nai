import Link from "next/link";
import { PublicHeader } from "@/mobile/public-header";
import { readCatalogTag, searchTagCatalog, tagCatalogStatus } from "@/lib/tag-catalog";
import { ArrowLeft } from "lucide-react";
import { TagActions } from "./tag-actions";

export default async function TagCatalogPage({ searchParams }: { searchParams: Promise<{ key?: string; q?: string }> }) {
  const params = await searchParams;
  const query = String(params.q || "").trim().slice(0, 80);
  const key = String(params.key || "").slice(0, 512);
  const item = key ? readCatalogTag(key) : null;
  const hits = !key && query.length >= 2 ? searchTagCatalog(query, 40) || [] : [];
  const status = tagCatalogStatus();
  return <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
    <PublicHeader current="tags" />
    <section className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
      {key && <Link replace href={query ? `/tags?q=${encodeURIComponent(query)}` : "/tags"} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--muted)]"><ArrowLeft size={18} />返回检索结果</Link>}
      <form className="flex gap-2" action="/tags"><input aria-label="搜索标签数据库" name="q" defaultValue={query} placeholder="搜索英文标签、中文标题或说明" minLength={2} maxLength={80} className="field min-w-0 flex-1" /><button className="rounded bg-[var(--rose)] px-4 py-2 text-sm text-white">搜索</button></form>
      {!status.available && <p role="status">标签数据库尚未导入。</p>}
      {status.available && !status.complete && <p role="status" className="text-sm text-[var(--muted)]">数据同步尚未完成，当前已入库记录可以读取。</p>}
      {key && !item && <p role="status">未找到这条记录。</p>}
      {item && <article className="space-y-4 rounded-lg bg-[var(--panel)] p-4 sm:p-6">
        <header><p className="text-xs text-[var(--muted)]">{item.source} · {item.categoryName}</p><h2 className="mt-2 break-words text-xl font-semibold">{item.displayName}</h2><p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">{item.name}</p></header>
        <TagActions value={item.insertion} />
        {item.zh && <p>{item.zh}</p>}
        {item.descriptionStatus === "missing" && <p className="text-sm text-[var(--muted)]">原站未提供独立介绍；以下仅列出实际来源信息。</p>}
        {item.descriptionStatus === "context" && <p className="text-sm text-[var(--muted)]">以下是包含此标签的原始提示词组合说明。</p>}
        <section><h2 className="mb-2 font-semibold">完整介绍</h2><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{item.description}</pre></section>
        {item.source === "quicktagcloud" && <section><h2 className="mb-2 font-semibold">完整提示词</h2><pre className="whitespace-pre-wrap break-words text-sm leading-7">{String(item.raw.tags || item.raw.prompt || item.insertion)}</pre></section>}
        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-block text-sm text-[var(--rose)]">查看原始来源 ↗</a>
        <details><summary className="cursor-pointer text-sm font-semibold">原始记录（保留全部字段）</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">{JSON.stringify(item.raw, null, 2)}</pre></details>
        {item.wikis.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold">全部原始词条记录</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">{JSON.stringify(item.wikis, null, 2)}</pre></details>}
      </article>}
      {query && !key && <section className="space-y-3"><h2 className="text-lg font-semibold">标签检索结果</h2>{hits.map((hit) => <Link key={hit.catalogKey} href={`/tags?key=${encodeURIComponent(hit.catalogKey)}&q=${encodeURIComponent(query)}`} className="block rounded-lg bg-[var(--panel)] p-4"><b className="break-words text-sm">{hit.displayName}</b><span className="ml-2 text-xs text-[var(--muted)]">{hit.source} · {hit.categoryName}</span>{hit.zh && <p className="mt-1 text-sm">{hit.zh}</p>}<p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-6 text-[var(--muted)]">{hit.description}</p></Link>)}{!hits.length && <p>没有找到匹配记录。</p>}</section>}
    </section>
  </main>;
}
