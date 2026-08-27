"use client";

/**
 * 图片广场投稿弹窗（历史页与广场页共用）。
 * 错误信息显示在弹窗内部，避免被浮层遮挡。
 */

import { Check, ChevronDown, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readJson, SessionExpiredError } from "@/app/session-notice";

type Rating = "general" | "sensitive";
type Source = "other" | "lfn" | "local";
type GalleryOption<T extends string> = { value: T; label: string; description?: string };

export type GallerySubmitForm = {
  historyId?: string;
  title: string;
  authorName: string;
  rating: Rating;
  source: Source;
  tags: string;
  exposeParameters: boolean;
  file?: File;
};

function GallerySelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: GalleryOption<T>[]; onChange: (value: T) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <div className="relative mt-2" ref={rootRef}>
      <button type="button" className="gallery-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{selected?.label}</span><ChevronDown size={16} aria-hidden="true" className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open && <div className="gallery-select-menu" role="listbox" aria-label={label}>
        {options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className="gallery-select-option" key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>
          <Check size={15} className={option.value === value ? "text-[var(--rose)]" : "opacity-0"} /><span><b>{option.label}</b>{option.description && <small>{option.description}</small>}</span>
        </button>)}
      </div>}
    </div>
  );
}

export function GallerySubmitDialog({
  form,
  onChange,
  onClose,
  onPublished,
  onSessionExpired,
}: {
  form: GallerySubmitForm;
  onChange: (form: GallerySubmitForm | null) => void;
  onClose: () => void;
  onPublished: () => void;
  onSessionExpired?: (message: string) => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  async function publish() {
    setPublishing(true);
    setError("");
    try {
      const requestBody: BodyInit = form.source === "lfn" ? JSON.stringify({
        historyId: form.historyId,
        title: form.title,
        authorName: form.authorName,
        rating: form.rating,
        source: form.source,
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        exposeParameters: form.exposeParameters,
      }) : (() => {
        const data = new FormData();
        if (form.file) data.set("file", form.file);
        data.set("title", form.title);
        data.set("authorName", form.authorName);
        data.set("rating", form.rating);
        data.set("source", form.source);
        data.set("tags", form.tags);
        data.set("prompt", "");
        data.set("negativePrompt", "");
        data.set("parameters", "{}");
        return data;
      })();
      const response = await fetch("/api/gallery", {
        method: "POST",
        ...(form.source === "lfn" ? { headers: { "Content-Type": "application/json" } } : {}),
        body: requestBody,
      });
      const result = await readJson<{ message?: string }>(response, "发布失败");
      if (!response.ok) throw new Error(result.message || "发布失败");
      onChange(null);
      onPublished();
    } catch (submitError) {
      if (submitError instanceof SessionExpiredError) {
        onSessionExpired?.(submitError.message);
        onClose();
      } else setError(submitError instanceof Error ? submitError.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#202328]/45 p-4 backdrop-blur-[2px]">
      <div className="max-h-[min(720px,calc(100vh-32px))] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--line)] bg-[#fffefa] p-5 text-[var(--ink)] shadow-[0_24px_70px_rgba(32,35,40,.24)] sm:p-6">
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">PUBLIC SQUARE</p>
            <h2 className="mt-1 font-[var(--font-display)] text-2xl font-semibold">提交作品</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">作品会直接公开发布，不经过人工审核。禁止 R18、NSFW 和色情内容；上传图片必须包含可解析的 NAI 生成参数。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-white text-[var(--muted)] hover:text-[var(--ink)]"><X size={18} /></button>
        </div>
        {error && <div className="mt-4 rounded border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">{error}</div>}
        <div className="mt-6 space-y-5">
          <label className="block text-sm font-semibold">标题<input className="field mt-2 h-11 w-full px-4" value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} maxLength={80} /></label>
          <label className="block text-sm font-semibold">作者 / 画师<input className="field mt-2 h-11 w-full px-4" value={form.authorName} onChange={(event) => onChange({ ...form, authorName: event.target.value })} placeholder="请填写作品作者或画师署名" maxLength={80} required /><small className="mt-1 block font-normal text-[var(--muted)]">将公开显示在作品信息中；请为转载作品正确署名。</small></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="text-sm font-semibold">内容评级<GallerySelect label="内容评级" value={form.rating} onChange={(rating) => onChange({ ...form, rating })} options={[{ value: "general", label: "General · 普通", description: "全年龄内容" }, { value: "sensitive", label: "Sensitive · 敏感", description: "非 R18 的敏感内容" }]} /></div>
            <div className="text-sm font-semibold">图片来源<GallerySelect label="图片来源" value={form.source} onChange={(source) => onChange({ ...form, source, file: source === "lfn" ? undefined : form.file })} options={[{ value: "lfn", label: "LFN · 历史图片", description: "从当前账号历史记录导入" }, { value: "local", label: "本地上传", description: "上传本地 NAI 图片" }, { value: "other", label: "Other · 其他来源", description: "转载或外部 NAI 图片" }]} /></div>
          </div>
          {form.source !== "lfn" && <label className="block text-sm font-semibold">上传含 NAI 参数的图片<span className="mt-2 flex min-h-12 cursor-pointer items-center rounded-md border border-dashed border-[var(--line)] bg-white px-4 text-sm font-normal text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)]"><input type="file" accept="image/png,image/jpeg" className="w-full text-xs file:mr-3 file:rounded-full file:border-0 file:bg-[#f1eee7] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[var(--ink)]" onChange={(event) => onChange({ ...form, file: event.target.files?.[0] })} /></span><small className="mt-1 block font-normal text-[var(--muted)]">仅支持 PNG/JPEG，且必须包含 NAI 参数。</small></label>}
          <label className="block text-sm font-semibold">公开标签<span className="field mt-2 flex h-11 items-center px-4"><input className="w-full bg-transparent outline-none" value={form.tags} onChange={(event) => onChange({ ...form, tags: event.target.value })} placeholder="例如：azure lane, blue hair, night" /></span><small className="mt-1 block font-normal text-[var(--muted)]">使用英文逗号分隔标签。</small></label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--line)] bg-[#f7f5ef] p-3 text-sm"><input className="mt-0.5 accent-[var(--rose)]" type="checkbox" checked={form.exposeParameters} onChange={(event) => onChange({ ...form, exposeParameters: event.target.checked })} /><span><b>公开正面与负面提示词及详细生成参数</b><small className="mt-1 block font-normal leading-5 text-[var(--muted)]">关闭后，其他用户只能查看图片和公开标签。</small></span></label>
        </div>
        <div className="mt-6 flex justify-end gap-3 border-t border-[var(--line)] pt-5"><button type="button" onClick={onClose} className="h-10 rounded-full border border-[var(--line)] bg-white px-5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)]">取消</button><button type="button" onClick={publish} disabled={publishing} className="flex h-10 items-center gap-2 rounded-full bg-[var(--rose)] px-5 text-sm font-semibold text-white shadow-sm hover:bg-[var(--rose-dark)] disabled:opacity-50"><Send size={15} />{publishing ? "提交中…" : "直接发布"}</button></div>
      </div>
    </div>
  );
}
