"use client";
import { ImagePlus, X } from "lucide-react";
import { MAX_ASSISTANT_IMAGES } from "@/lib/assistant-limits";
import "./assistant-attachments.css";

export function AssistantAttachments({ images, loading, onAdd, onRemove, onClear, onPreview }: {
  images: string[]; loading: boolean; onAdd: (files: File[]) => void; onRemove: (index: number) => void; onClear: () => void; onPreview: (src: string) => void;
}) {
  return <section className="assistant-attachments" aria-label="助手参考图">
    <div className="assistant-attachments-heading"><label title="上传参考图，最多 10 张" aria-disabled={loading || images.length >= MAX_ASSISTANT_IMAGES}>
      <ImagePlus size={15} /><span>{loading ? "处理图片中…" : "添加参考图"}</span>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={loading || images.length >= MAX_ASSISTANT_IMAGES} aria-label="上传识图图片" onChange={event => { const files = [...(event.target.files || [])]; event.target.value = ""; onAdd(files); }} />
    </label><span>{images.length} / {MAX_ASSISTANT_IMAGES}</span>{images.length > 0 && <button type="button" onClick={onClear}>清空</button>}</div>
    <p>可多选上传或粘贴，按顺序一起分析；图片自动压缩。目标迭代复核使用前 9 张参考图与最新生成结果。</p>
    {images.length > 0 && <div className="assistant-attachments-grid">{images.map((image, index) => <div key={index}>
      <button type="button" aria-label={`查看参考图 ${index + 1}`} onClick={() => onPreview(image)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={`参考图 ${index + 1}`} /><span>{index + 1}</span>
      </button><button type="button" aria-label={`移除参考图 ${index + 1}`} onClick={() => onRemove(index)}><X size={12} /></button>
    </div>)}</div>}
  </section>;
}
