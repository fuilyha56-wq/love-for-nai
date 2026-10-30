"use client";

/**
 * 图片广场投稿弹窗（历史页与广场页共用）。
 * 错误信息显示在弹窗内部，避免被浮层遮挡。
 */

import "./gallery-submit.css";
import { GalleryHistoryField } from "@/app/ui/gallery-history-field";
import { Send, X } from "lucide-react";
import { useState } from "react";
import { AdaptiveDialog } from "@/mobile/ui/adaptive-dialog";
import { PopupSelect } from "@/mobile/ui/popup-select";
import { GalleryPublicationFields } from "@/app/ui/gallery-publication-fields";
import type { GalleryPublicationInput } from "@/lib/gallery-publication";
import styles from "@/mobile/ui/discovery-controls.module.css";
import { GalleryUploadField } from "@/mobile/gallery/gallery-upload-field";
import { readJson, SessionExpiredError } from "@/mobile/session-notice";

type Rating = "general" | "r13" | "r17" | "r18";
type Source = "other" | "lfn" | "local";
type GalleryOption<T extends string> = { value: T; label: string; description?: string };

export function validateGallerySubmitForm(form: GallerySubmitForm): string | null {
  if (form.originalFile && (!(["image/png", "image/jpeg"].includes(form.originalFile.type)) || form.originalFile.size > 20 * 1024 * 1024)) return "校验原图须为不超过 20 MB 的 PNG 或 JPEG";
  if (form.originalFile && (form.files?.length || 0) > 1) return "提供校验原图时请逐件投稿，确保原图与参赛图一一对应";
  if (form.title.trim().length > 500) return "作品名不能超过 500 字符";
  if (!["other", "lfn", "local"].includes(form.source)) return "图片来源不合法";
  if (form.source === "lfn" && !form.historyId?.trim()) return "请先从图片历史中选择一张图片";
  if (form.source !== "lfn") {
    const files = form.files?.length ? form.files : form.file ? [form.file] : [];
    if (!files.length) return "请选择要上传的图片";
    if (files.length > 20) return "每次最多选择 20 张图片";
    const invalid = files.find((file) => !/^(image\/png|image\/jpeg)$/.test(file.type));
    if (invalid) return "只支持 PNG 或 JPEG 图片";
    const oversized = files.find((file) => file.size > 20 * 1024 * 1024);
    if (oversized) return "图片不能超过 20 MB";
  }
  return null;
}

export type GallerySubmitForm = GalleryPublicationInput & {
  originalFile?: File;
  historyId?: string;
  title: string;
  authorName: string;
  rating: Rating;
  source: Source;
  tags: string;
  exposeParameters: boolean;
  requireLikeForParameters?: boolean;
  file?: File;
  files?: File[];
};

function GallerySelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: GalleryOption<T>[]; onChange: (value: T) => void }) {
  return <div className={`mt-2 ${styles.select}`}><PopupSelect value={value} options={options} ariaLabel={label} onChange={next => onChange(next as T)} menuMinWidth={260} menuClassName={styles.menu} /></div>;
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
  onPublished: (message?: string) => void;
  onSessionExpired?: (message: string) => void;
}) {
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [historyMode, setHistoryMode] = useState(form.source === "lfn");

  async function publish() {
    const validationError = validateGallerySubmitForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setPublishing(true);
    setError("");
    try {
      const files = form.files?.length ? form.files : form.file ? [form.file] : [];
      if (form.source === "lfn" && !form.originalFile) {
        const response = await fetch("/api/gallery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            promptMode: form.promptMode, partialPrompt: form.partialPrompt, partialNegativePrompt: form.partialNegativePrompt, partialCharacters: form.partialCharacters, upscaled: form.upscaled,
            historyId: form.historyId,
            title: form.title,
            authorName: form.authorName,
            rating: form.rating,
            source: form.source,
            tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
            exposeParameters: form.exposeParameters,
            requireLikeForParameters: form.exposeParameters && form.requireLikeForParameters === true,
          }),
        });
        const result = await readJson<{ message?: string }>(response, "发布失败");
        if (!response.ok) throw new Error(result.message || "发布失败");
      } else {
        const failedFiles: File[] = [];
        let succeeded = 0;
        const uploadFiles: Array<File | undefined> = form.source === "lfn" ? [undefined] : files;
        for (const file of uploadFiles) {
          const data = new FormData();
          if (file) data.set("file", file);
          else data.set("historyId", form.historyId || "");
          if (form.originalFile) data.set("originalFile", form.originalFile);
          if (form.promptMode) data.set("promptMode", form.promptMode);
          data.set("partialPrompt", form.partialPrompt || "");
          data.set("partialNegativePrompt", form.partialNegativePrompt || "");
          data.set("partialCharacters", JSON.stringify(form.partialCharacters || []));
          data.set("upscaled", String(form.upscaled === true));
          data.set("title", form.title || file?.name.replace(/\.[^.]+$/, "") || "未命名作品");
          data.set("authorName", form.authorName);
          data.set("rating", form.rating);
          data.set("source", form.source);
          data.set("tags", form.tags);
          data.set("prompt", "");
          data.set("negativePrompt", "");
          data.set("parameters", "{}");
          data.set("exposeParameters", String(form.exposeParameters));
          data.set("requireLikeForParameters", String(form.exposeParameters && form.requireLikeForParameters === true));
          const response = await fetch("/api/gallery", { method: "POST", body: data });
          const result = await readJson<{ message?: string }>(response, "发布失败");
          if (!response.ok) {
            if (file) failedFiles.push(file);
            if (uploadFiles.length === 1) throw new Error(result.message || "发布失败");
          } else {
            succeeded += 1;
          }
        }
        if (failedFiles.length) {
          onChange({ ...form, file: failedFiles[0], files: failedFiles });
          throw new Error(`${succeeded} 张已提交，${failedFiles.length} 张失败；请检查失败文件与公开提示词校验结果后重试。`);
        }
      }
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

  return <AdaptiveDialog label="提交作品" onClose={onClose} className="gallery-submit-dialog">
    <header className="lfn-adaptive-heading"><h2>提交作品</h2><button type="button" onClick={onClose} aria-label="关闭提交作品"><X size={20} /></button></header>
    <div className="lfn-adaptive-body"><p className="mb-4 text-sm leading-6 text-[var(--muted)]">提交后进入人工审核，通过后展示在图片广场。请填写正确署名与年龄评级。</p>
        <div className="space-y-4">

          <label className="block text-sm font-semibold">标题<input className="field mt-2 h-11 w-full px-4" value={form.title} onChange={(event) => onChange({ ...form, title: event.target.value })} maxLength={500} /></label>
          <label className="block text-sm font-semibold">作者 / 画师<input className="field mt-2 h-11 w-full px-4" value={form.authorName} onChange={(event) => onChange({ ...form, authorName: event.target.value })} placeholder="请填写作品作者或画师署名" maxLength={80} required /><small className="mt-1 block font-normal text-[var(--muted)]">将公开显示在作品信息中；请为转载作品正确署名。</small></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="text-sm font-semibold">年龄评级<GallerySelect label="年龄评级" value={form.rating} onChange={(rating) => onChange({ ...form, rating })} options={[{ value: "general", label: "全年龄 · General", description: "适合所有年龄段" }, { value: "r13", label: "R13", description: "13 岁以下不宜，轻度敏感" }, { value: "r17", label: "R17", description: "敏感内容，广场默认打码" }, { value: "r18", label: "R18", description: "成人内容，广场默认打码" }]} /></div>
            <div className="text-sm font-semibold">图片来源<GallerySelect label="图片来源" value={historyMode ? "lfn" : form.source} onChange={(source: Source) => { if (publishing || (source === "lfn" && historyMode)) return; setError(""); setHistoryMode(source === "lfn"); onChange({ ...form, source, historyId: source === "lfn" ? form.historyId : undefined, file: source === "lfn" ? undefined : form.file, files: source === "lfn" ? undefined : form.files }); }} options={[{ value: "lfn" as const, label: "图片历史", description: "选择账号或本机历史原图" }, { value: "local" as const, label: "本地上传", description: "上传本地 NAI 图片" }, { value: "other" as const, label: "Other · 其他来源", description: "转载或外部 NAI 图片" }]} /></div>
          </div>
          {historyMode && <GalleryHistoryField historyId={form.historyId} file={form.file} title={form.title} disabled={publishing} onSelect={(item) => { setError(""); onChange({ ...form, historyId: item.historyId, source: item.historyId ? "lfn" : "local", file: item.file, files: item.file ? [item.file] : undefined, title: form.title.trim() ? form.title : item.prompt.slice(0, 80) }); }} onClear={() => { setError(""); onChange({ ...form, historyId: undefined, source: "lfn", file: undefined, files: undefined }); }} />}
          {!historyMode && form.source !== "lfn" && <GalleryUploadField files={form.files?.length ? form.files : form.file ? [form.file] : []} onChange={(files) => { setError(""); onChange({ ...form, file: files[0], files }); }} />}
          <label className="block text-sm font-semibold">公开标签<span className="field mt-2 flex h-11 items-center px-4"><input className="w-full bg-transparent outline-none" value={form.tags} onChange={(event) => onChange({ ...form, tags: event.target.value })} placeholder="例如：azure lane, blue hair, night" /></span><small className="mt-1 block font-normal text-[var(--muted)]">使用英文逗号分隔标签。</small></label>
          <GalleryPublicationFields allowOriginalProof form={form} onChange={patch => onChange({ ...form, ...patch })} />
        </div>
    </div>
    <footer className="lfn-adaptive-footer">
      {error && <p role="alert" className="mb-3 text-sm text-[var(--accent-text)]">{error}</p>}
      <div><button type="button" onClick={onClose} className="bg-[var(--panel)]">取消</button><button type="button" onClick={publish} disabled={publishing} className="bg-[var(--rose-dark)] text-white disabled:opacity-50"><Send size={16} />{publishing ? "提交中…" : "提交审核"}</button></div>
    </footer>
  </AdaptiveDialog>;
}
