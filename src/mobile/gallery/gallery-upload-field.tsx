"use client";

import { ImagePlus } from "lucide-react";
import { useId } from "react";
import styles from "./gallery-upload-field.module.css";

export function GalleryUploadField({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const id = useId();
  return <div className={styles.field}>
    <span className={styles.label}>上传参赛图片</span>
    <label className={styles.dropzone} htmlFor={id}>
      <input id={id} type="file" aria-label="选择投稿图片" accept="image/png,image/jpeg" multiple onChange={(event) => { onChange(Array.from(event.target.files || [])); event.target.value = ""; }} />
      <ImagePlus size={24} aria-hidden="true" />
      <span><b>{files.length ? `已选择 ${files.length} 张图片 · 重新选择` : "选择要分享的图片"}</b><small>PNG / JPEG · 每张不超过 20 MB · 最多 20 张</small></span>
    </label>
    {files.length > 0 && <p className={styles.files} title={files.map((file) => file.name).join("、")}>{files.map((file) => file.name).join("、")}</p>}
    <p className={styles.hint}>自动检测生成元数据；无法读取时归入“无原数据图”，仍可投稿。提交后逐张进入审核。</p>
  </div>;
}
