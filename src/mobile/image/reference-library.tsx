"use client";
import Image from "next/image";

import { useRef, useState } from "react";
import { MAX_STUDIO_REFERENCES, parseImageReferenceBundle, type ImageReferenceAsset, type ImageReferenceKind, type ImageReferenceSelection, type EncodedImageReference } from "@/lib/image-references";
import { LfnSelect } from "@/mobile/ui/lfn-select";
import "./reference-library.css";

export type ReferenceLibraryProps = {
  kind: ImageReferenceKind;
  references: ImageReferenceSelection[];
  library: ImageReferenceAsset[];
  encodings: Record<string, EncodedImageReference>;
  encodingId: string | null;
  disabled?: boolean;
  onAdd: (kind: ImageReferenceKind, asset: ImageReferenceAsset) => boolean;
  onUpdate: (kind: ImageReferenceKind, id: string, change: Partial<Pick<ImageReferenceSelection, "enabled" | "strength" | "information" | "fidelity" | "referenceType">>) => void;
  onRemove: (kind: ImageReferenceKind, id: string) => void;
  onReplace: (kind: ImageReferenceKind, items: ImageReferenceSelection[]) => void;
  onSave: (asset: ImageReferenceAsset) => Promise<void>;
  onDeleteSaved: (id: string) => Promise<void>;
  onEncode: (asset: ImageReferenceSelection) => Promise<void>;
  onCancelEncoding: () => void;
  onClearCache: () => Promise<void>;
  onNotice: (message: string) => void;
};
export function ReferenceLibrary(p: ReferenceLibraryProps) {
  const importRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const active = p.references.filter((item) => item.enabled);
  const isVibe = p.kind === "vibe-transfer";
  function exportBundle() {
    const blob = new Blob([JSON.stringify({ version: 1, kind: p.kind, references: p.references }, null, 2)], { type: "application/json" });
    if (blob.size > 64 * 1024 * 1024) { p.onNotice("参考配置超过 64 MB，请移除部分图片后分组导出。"); return; }
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `lfn-${p.kind}-references.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="mobile-reference-library" data-reference-kind={p.kind}>
    <div className="mobile-reference-library-toolbar"><strong>{active.length}/{MAX_STUDIO_REFERENCES} 张启用</strong><button type="button" onClick={() => importRef.current?.click()} disabled={p.disabled}>导入配置</button><button type="button" onClick={exportBundle} disabled={!p.references.length}>导出配置</button></div>
    <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={async (event) => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
      try { if (file.size > 64 * 1024 * 1024) throw new Error("参考配置不能超过 64 MB。"); const bundle = parseImageReferenceBundle(JSON.parse(await file.text())); if (bundle.kind !== p.kind) throw new Error("请在对应的参考类型中导入此配置。"); p.onReplace(p.kind, bundle.references); }
      catch (error) { p.onNotice(error instanceof Error ? error.message : "无法导入配置。"); }
    }}/>
    {p.references.map((item, index) => <article className="mobile-reference-library-item" key={item.id}>
      <Image unoptimized width={512} height={512} src={item.data} alt={item.name}/>
      <div className="mobile-reference-library-item-content"><label className="mobile-reference-library-enable"><input type="checkbox" checked={item.enabled} disabled={p.disabled} onChange={(event) => p.onUpdate(p.kind, item.id, { enabled: event.target.checked })}/><span>{index + 1}. {item.name}</span></label>
        <label>参考强度 <output>{item.strength.toFixed(2)}</output><input aria-label={`参考 ${index + 1} 强度`} type="range" min="0" max="1" step="0.01" value={item.strength} disabled={p.disabled} onChange={(event) => p.onUpdate(p.kind, item.id, { strength: Number(event.target.value) })}/></label>
        {isVibe ? <label>信息提取 <output>{item.information.toFixed(2)}</output><input aria-label={`参考 ${index + 1} 信息提取`} type="range" min="0" max="1" step="0.01" value={item.information} disabled={p.disabled} onChange={(event) => p.onUpdate(p.kind, item.id, { information: Number(event.target.value) })}/></label> : <><label>参考类型<LfnSelect aria-label={`参考 ${index + 1} 类型`} value={item.referenceType} disabled={p.disabled} onChange={(event) => p.onUpdate(p.kind, item.id, { referenceType: event.target.value as ImageReferenceSelection["referenceType"] })}><option value="character&style">角色与画风</option><option value="character">角色</option><option value="style">画风</option></LfnSelect></label><label>保真度 <output>{item.fidelity.toFixed(2)}</output><input aria-label={`参考 ${index + 1} 保真度`} type="range" min="0" max="1" step="0.01" value={item.fidelity} disabled={p.disabled} onChange={(event) => p.onUpdate(p.kind, item.id, { fidelity: Number(event.target.value) })}/></label></>}
        <div className="mobile-reference-library-item-actions"><button type="button" onClick={() => void p.onSave(item)}>存入图库</button><button type="button" disabled={p.disabled} onClick={() => p.onRemove(p.kind, item.id)}>移除</button>{isVibe && (p.encodingId === item.id ? <button type="button" onClick={p.onCancelEncoding}>取消预处理</button> : <button type="button" disabled={p.disabled || !!p.encodingId || !!p.encodings[item.id]} onClick={() => void p.onEncode(item)}>{p.encodings[item.id] ? "已缓存" : "预处理并缓存"}</button>)}</div>
      </div>
    </article>)}
    {isVibe && active.length > 1 && active.reduce((total, item) => total + item.strength, 0) > 1 && <p className="mobile-reference-library-hint">叠加强度超过 1；若画面受到过强影响，可降低各图强度。</p>}
    {isVibe && <p className="mobile-reference-library-hint">预处理会产生费用。缓存保存在本机，按账号、模型和信息提取值区分；导出配置仅包含原图和参数。</p>}
    <details><summary>本机参考图库（{p.library.length}）</summary><input aria-label="搜索参考图库" placeholder="搜索图片名称" value={search} onChange={(event) => setSearch(event.target.value)}/><div className="mobile-reference-library-saved">{p.library.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).map((item) => <article key={item.id}><Image unoptimized width={512} height={512} src={item.data} alt={item.name}/><span>{item.name}</span><button type="button" disabled={p.disabled || p.references.length >= MAX_STUDIO_REFERENCES} onClick={() => p.onAdd(p.kind, { ...item, id: crypto.randomUUID() })}>加入参考</button><button type="button" onClick={() => void p.onDeleteSaved(item.id)}>删除本机图片</button></article>)}</div>{isVibe && <button type="button" disabled={!!p.encodingId} onClick={() => void p.onClearCache()}>清除本机风格缓存</button>}</details>
  </div>;
}
