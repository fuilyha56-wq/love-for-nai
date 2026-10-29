"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Images, Paintbrush, X } from "lucide-react";
import { listReferenceAssets, saveReferenceAsset, subscribeReferenceLibrary } from "@/lib/client-reference-library";
import { clientUuid } from "@/lib/client-uuid";
import type { CharacterReferenceBinding } from "@/lib/character-reference";
import type { ImageReferenceAsset } from "@/lib/image-references";
import styles from "./character-reference-field.module.css";

type Props = {
  owner: string; value?: CharacterReferenceBinding;
  onChange: (value: CharacterReferenceBinding | undefined) => void;
  onEdit: () => void; canEdit: boolean; editHint: string;
};

export function CharacterReferenceField(p: Props) {
  return <OwnedCharacterReferenceField key={p.owner} {...p} />;
}

function OwnedCharacterReferenceField(p: Props) {
  const [assets, setAssets] = useState<ImageReferenceAsset[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const epoch = useRef(0);
  const value = p.value?.owner === p.owner ? p.value : undefined;
  const asset = assets.find(item => item.id === value?.assetId);
  useEffect(() => {
    const current = ++epoch.current;
    let request = 0;
    const refresh = () => {
      const revision = ++request;
      void listReferenceAssets(p.owner).then(items => { if (epoch.current === current && revision === request) { setAssets(items); setLoaded(true); } })
        .catch(() => { if (epoch.current === current && revision === request) { setLoaded(true); setError("无法读取本机参考图库，请检查浏览器存储权限。"); } });
    };
    refresh();
    const unsubscribe = subscribeReferenceLibrary(p.owner, refresh);
    return () => { epoch.current = current + 1; unsubscribe(); };
  }, [p.owner]);
  const bind = (item: ImageReferenceAsset) => {
    p.onChange({ assetId: item.id, owner: p.owner, strength: value?.strength ?? .6, fidelity: value?.fidelity ?? 1 });
    setLibraryOpen(false); setError("");
  };
  const upload = async (file: File) => {
    const current = epoch.current;
    setError(""); setBusy(true);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error("请选择不超过 15 MB 的 PNG、JPEG 或 WebP 图片。");
      const bitmap = await createImageBitmap(file);
      const valid = bitmap.width > 0 && bitmap.height > 0 && bitmap.width * bitmap.height <= 32_000_000;
      bitmap.close();
      if (!valid) throw new Error("参考图像素过大，请使用不超过 3200 万像素的图片。");
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("读取图片失败。")); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
      if (epoch.current !== current) return;
      const saved = await saveReferenceAsset(p.owner, { id: clientUuid(), name: file.name, data, createdAt: Date.now() });
      if (epoch.current !== current) return;
      setAssets(items => [saved, ...items.filter(item => item.id !== saved.id)]); setLoaded(true); bind(saved);
    } catch (reason) { if (epoch.current === current) setError(reason instanceof Error ? reason.message : "无法保存参考图。"); }
    finally { if (epoch.current === current) setBusy(false); }
  };
  return <section className={styles.field} aria-label="角色参考图">
    <div className={styles.heading}><span><ImagePlus size={15} />角色参考图</span><small>与此角色一起保存</small></div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
    {asset && <div className={styles.selected}><Image unoptimized src={asset.data} alt={asset.name} width={64} height={80} /><span>{asset.name}</span><button type="button" aria-label="解除此角色的参考图关联" disabled={busy} onClick={() => p.onChange(undefined)}><X size={15} /></button></div>}
    {loaded && value && !asset && <p role="status">原参考图已从本机图库移除，请重新选择。</p>}
    <div className={styles.actions}><button type="button" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={15} />{busy ? "保存中…" : asset ? "替换图片" : "上传参考图"}</button><button type="button" disabled={busy} aria-expanded={libraryOpen} onClick={() => setLibraryOpen(!libraryOpen)}><Images size={15} />本机图库</button></div>
    {libraryOpen && <div className={styles.library}><input aria-label="搜索角色参考图库" placeholder="搜索图片名称" value={query} onChange={event => setQuery(event.target.value)} /><div className={styles.grid}>{assets.filter(item => item.name.toLowerCase().includes(query.toLowerCase())).map(item => <button key={item.id} type="button" disabled={busy} aria-label={`选择角色参考图：${item.name}`} aria-pressed={item.id === value?.assetId} onClick={() => bind(item)}><Image unoptimized src={item.data} alt="" width={80} height={80} /><span>{item.name}</span></button>)}</div>{assets.length > 0 && !assets.some(item => item.name.toLowerCase().includes(query.toLowerCase())) && <p>没有匹配的图片，请换一个关键词。</p>}{!assets.length && <p>{loaded ? "本机图库暂无图片，上传后会自动保存。" : "正在读取本机图库…"}</p>}</div>}
    {asset && value && <><div className={styles.sliders}>{([['参考强度', 'strength'], ['保真度', 'fidelity']] as const).map(([label,key]) => <label key={key}><span>{label}<output>{value[key].toFixed(2)}</output></span><input type="range" aria-label={`角色${label}`} min={0} max={1} step={.05} value={value[key]} onChange={event => p.onChange({ ...value, [key]: Number(event.target.value) })} /></label>)}</div><button className={styles.edit} type="button" disabled={!p.canEdit || busy} onClick={p.onEdit}><Paintbrush size={15} />只重绘此角色区域</button><p>{p.editHint}</p></>}
    <p>普通生成不发送此图。角色重绘时只发送这一张参考图，请在编辑器涂选对应角色；选区外保留原图。</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
