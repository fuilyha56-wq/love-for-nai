"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { readReferenceAsset } from "@/lib/client-reference-library";
import { parseCharacterReference, type CharacterEditReference } from "@/lib/character-reference";
import type { ImageReferenceAsset } from "@/lib/image-references";
import styles from "./character-reference-field.module.css";

/** Resolve only this role's local asset; never read the global reference basket. */
export async function characterReferencePayload(reference: CharacterEditReference, userId: number | undefined, signal: AbortSignal) {
  const binding = parseCharacterReference(reference);
  if (!binding || !userId || binding.owner !== String(userId)) throw new Error("当前账号与角色参考图不匹配，请返回工作台重新选择。");
  const response = await fetch("/api/images/cache-scope", { cache: "no-store", signal });
  if (!response.ok || (await response.json()).scope !== `user:${userId}`) throw new Error("登录账号已变化，请刷新后重新选择角色参考图。");
  const asset = await readReferenceAsset(binding.owner, binding.assetId);
  signal.throwIfAborted();
  if (!asset) throw new Error("角色参考图已从本机图库移除，请返回角色卡重新选择。");
  return [{ reference_image: asset.data, reference_type: "character", strength: binding.strength, fidelity: binding.fidelity }];
}

export function CharacterEditReferenceCard({ reference, userId }: { reference: CharacterEditReference; userId?: number }) {
  const [asset, setAsset] = useState<{ id: string; owner: string; value?: ImageReferenceAsset }>();
  useEffect(() => {
    let active = true;
    if (reference.owner !== String(userId)) return;
    void readReferenceAsset(reference.owner, reference.assetId).then(value => {
      if (active) setAsset({ id: reference.assetId, owner: reference.owner, value });
    }).catch(() => { if (active) setAsset({ id: reference.assetId, owner: reference.owner }); });
    return () => { active = false; };
  }, [reference.owner, reference.assetId, userId]);
  const image = asset?.id === reference.assetId && asset.owner === String(userId) ? asset.value : undefined;
  const unavailable = reference.owner !== String(userId) || (asset?.id === reference.assetId && !image);
  return <section className={styles.field} aria-label="当前角色参考">
    <div className={styles.heading}><span>{reference.label} · 独立参考重绘</span></div>
    {image && <div className={styles.selected}><Image src={image.data} alt={image.name} width={64} height={80} unoptimized /><span>{image.name}</span></div>}
    <p>参考强度 {reference.strength.toFixed(2)} · 保真度 {reference.fidelity.toFixed(2)}</p>
    <p>涂选此角色后生成。仅使用这一张参考图；选区外保持原图，候选图需确认后应用。主画面提示词保持不变。</p>
    <p>精准参考会产生额外费用，实际扣费以模型来源为准。更换图片或参考强度请返回角色卡。</p>
    {unavailable && <p role="alert" className={styles.error}>参考图不可用，请返回角色卡重新选择。不会忽略参考图继续生成。</p>}
  </section>;
}
