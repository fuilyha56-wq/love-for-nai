"use client";

import Link from "next/link";
import { ArrowLeft, Grid3X3 } from "lucide-react";
import { useState } from "react";
import { WorkspaceNav } from "@/app/workspace-nav";
import { CustomLayoutEditor } from "@/app/settings/page";
import {
  loadCustomLayout,
  parseCustomLayout,
  resetCustomLayout,
  saveCustomLayout,
  type CustomLayoutPreferences,
} from "@/lib/appearance-store";

export default function CustomLayoutPage() {
  const [layout, setLayout] = useState<CustomLayoutPreferences>(() => loadCustomLayout());
  const [message, setMessage] = useState("");
  return (
    <main className="workspace-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--line)] bg-[var(--panel)]/95 px-4 backdrop-blur sm:px-7">
        <div className="flex items-center gap-3"><Grid3X3 size={20} className="text-[var(--rose)]" /><div><b className="block">自定义工作台</b><span className="text-[10px] text-[var(--muted)]">LAYOUT · 仅保存在本机</span></div></div>
        <Link href="/image?layoutEditor=1" className="flex h-9 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold hover:border-[var(--rose)]"><ArrowLeft size={16} />进入图片工作台编辑器</Link>
      </header>
      <WorkspaceNav />
      <section className="mx-auto max-w-5xl p-4 sm:p-7">
        {message && <p className="mb-4 rounded border border-[var(--line)] bg-[var(--panel)] p-3 text-sm text-[var(--rose)]">{message}</p>}
        <article className="panel rounded-md p-5 sm:p-7">
          <p className="text-[10px] font-bold tracking-[0.16em] text-[var(--rose)]">WORKSPACE LAYOUT</p>
          <h1 className="mt-2 text-2xl font-semibold">自由编排你的生图工作台</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">拖动模块调整位置，拖动右下角调整大小。网格、边界和碰撞限制会持续保护布局。</p>
          <CustomLayoutEditor
            layout={layout}
            onChange={(next) => setLayout(parseCustomLayout(next))}
            onSave={() => { setLayout(saveCustomLayout(layout)); setMessage("自定义布局已保存。"); }}
            onReset={() => { setLayout(resetCustomLayout()); setMessage("已恢复默认布局，请点击保存后应用。"); }}
          />
        </article>
      </section>
    </main>
  );
}