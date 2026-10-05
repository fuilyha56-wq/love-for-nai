"use client";

import Image from "next/image";
import { Copy, Ellipsis, History, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { ImageProviderProtocol } from "@/lib/image-model-capabilities";
import "./replica-history.css";

export type ReplicaHistoryItem = {
  image: string;
  prompt: string;
  negative: string;
  seed?: number;
  width: number;
  height: number;
  operation: string;
  createdAt: number;
  steps: number;
  scale: number;
  sampler: string;
  noise_schedule?: string;
  cfg_rescale?: number;
  strength?: number;
  n?: number;
  n_samples?: number;
  noise?: number;
  params_version?: number;
  qualityToggle?: boolean;
  ucPreset?: number;
  legacy?: boolean;
  add_original_image?: boolean;
  autoSmea?: boolean;
  deliberate_euler_ancestral_bug?: boolean;
  prefer_brownian?: boolean;
  sm?: boolean;
  sm_dyn?: boolean;
  uncond_scale?: number;
  v4_negative?: boolean;
  v4_prompt?: boolean;
  dynamic_thresholding?: boolean;
  controlnet_strength?: number;
  emotion?: string;
  defry?: number;
  use_coords?: boolean;
  reference_strength?: number;
  reference_information_extracted?: number;
  [key: string]: unknown;
  model?: string;
  providerId?: string;
  imageProtocol?: ImageProviderProtocol;
  quality?: string;
  imageSize?: string;
  background?: string;
};

const HISTORY_PARAMETER_LABELS: Array<[string, string]> = [
  ["prompt", "提示词 / Prompt"], ["negative", "反向提示词 / Negative prompt"],
  ["model", "模型 / Model"], ["providerId", "服务商 / Provider"], ["imageProtocol", "图像协议 / Image protocol"],
  ["operation", "操作 / Operation"], ["width", "宽度 / Width"], ["height", "高度 / Height"],
  ["steps", "步数 / Steps"], ["scale", "引导强度 / Scale"], ["sampler", "采样器 / Sampler"],
  ["noise_schedule", "噪声调度 / Noise schedule"], ["cfg_rescale", "CFG 重缩放 / CFG rescale"],
  ["strength", "重绘强度 / Strength"], ["seed", "种子 / Seed"], ["n", "生成数量 / Samples"], ["n_samples", "NAI 生成数量 / NAI samples"],
  ["noise", "噪声 / Noise"], ["params_version", "参数版本 / Params version"], ["quality", "质量 / Quality"],
  ["qualityToggle", "品质标签 / Quality tags"], ["ucPreset", "负向预设 / UC preset"], ["imageSize", "图像尺寸 / Image size"], ["background", "背景 / Background"],
  ["legacy", "遗留模式 / Legacy"], ["add_original_image", "附加原图 / Add original image"], ["autoSmea", "自动 SMEA / Auto SMEA"],
  ["sm", "SMEA / SMEA"], ["sm_dyn", "动态 SMEA / SMEA dynamic"], ["uncond_scale", "无条件尺度 / Uncond scale"],
  ["v4_negative", "V4 负向 / V4 negative"], ["v4_prompt", "V4 提示词 / V4 prompt"], ["dynamic_thresholding", "动态阈值 / Dynamic thresholding"],
  ["controlnet_strength", "ControlNet 强度 / ControlNet strength"], ["emotion", "表情 / Emotion"], ["defry", "去伪影 / Defry"],
  ["use_coords", "使用坐标 / Use coordinates"], ["reference_strength", "参考图强度 / Reference strength"],
  ["reference_information_extracted", "参考信息提取 / Reference information extracted"],
];

function displayHistoryParameter(value: unknown): string {
  if (typeof value === "string") return value || "（空）";
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "启用 / Enabled" : "禁用 / Disabled";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function historyParameterEntries(item: ReplicaHistoryItem): Array<[string, string, unknown]> {
  const knownKeys = new Set(HISTORY_PARAMETER_LABELS.map(([key]) => key));
  const entries = HISTORY_PARAMETER_LABELS
    .map(([key, label]) => [key, label, item[key]] as [string, string, unknown])
    .filter(([, , value]) => value !== undefined);
  for (const [key, value] of Object.entries(item)) {
    if (knownKeys.has(key) || value === undefined || ["image", "createdAt"].includes(key)) continue;
    entries.push([key, `${key} / ${key}`, value]);
  }
  return entries;
}

export type ReplicaHistoryProps = {
  items: ReplicaHistoryItem[];
  onOpen: (item: ReplicaHistoryItem) => void;
  onUse: (item: ReplicaHistoryItem, operation: string) => void;
  onDelete: (index: number) => void;
};

type HistoryCardProps = {
  item: ReplicaHistoryItem;
  index: number;
  copying: boolean;
  onCopy: (item: ReplicaHistoryItem) => Promise<void>;
  onOpen: ReplicaHistoryProps["onOpen"];
  onUse: ReplicaHistoryProps["onUse"];
  onDelete: ReplicaHistoryProps["onDelete"];
};

function HistoryCard({ item, index, copying, onCopy, onOpen, onUse, onDelete }: HistoryCardProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [natural, setNatural] = useState<{ image: string; width: number; height: number } | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const width = natural?.image === item.image ? natural.width : (Number.isFinite(item.width) && item.width > 0 ? item.width : 1);
  const height = natural?.image === item.image ? natural.height : (Number.isFinite(item.height) && item.height > 0 ? item.height : 1);

  useEffect(() => {
    if (!menuOpen) return;
    const place = () => {
      const button = menuButtonRef.current;
      const menu = menuRef.current;
      if (!button || !menu) return;
      const buttonBounds = button.getBoundingClientRect();
      const menuBounds = menu.getBoundingClientRect();
      const gap = 6;
      const left = Math.max(8, Math.min(buttonBounds.right - menuBounds.width, window.innerWidth - menuBounds.width - 8));
      const below = buttonBounds.bottom + gap;
      const above = buttonBounds.top - menuBounds.height - gap;
      setMenuPosition({ top: above >= 8 ? above : Math.min(below, window.innerHeight - menuBounds.height - 8), left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!cardRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menuOpen]);

  function focusMenuButton(): void {
    menuButtonRef.current?.focus({ preventScroll: true });
  }

  function menuKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (current + 1) % buttons.length
      : event.key === "ArrowUp" ? (current - 1 + buttons.length) % buttons.length
        : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
    if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
  }

  return (
    <article
      ref={cardRef}
      className={`replica-history-card${menuOpen ? " is-menu-open" : ""}`}
      onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) { event.preventDefault(); setMenuOpen(false); menuButtonRef.current?.focus(); }
        if (event.shiftKey && event.key === "F10") { event.preventDefault(); setMenuOpen(true); }
      }}
    >
      <button className="replica-history-preview" type="button" aria-label={`查看第 ${index + 1} 张历史图像`} title={item.prompt || "查看原图"} onClick={() => { setMenuOpen(false); onOpen(item); }}>
        <Image
          src={item.image}
          alt={item.prompt || `历史图像 ${index + 1}`}
          width={width}
          height={height}
          unoptimized
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              const next = { image: item.image, width: image.naturalWidth, height: image.naturalHeight };
              setNatural((previous) => previous?.image === item.image && previous.width === next.width && previous.height === next.height ? previous : next);
            }
          }}
        />
      </button>
      {historyParameterEntries(item).length > 0 && <details className="px-3 py-2 text-xs">
        <summary className="cursor-pointer text-[var(--muted)]">参数详情</summary>
        <dl className="mt-2 space-y-1">{historyParameterEntries(item).map(([key, label, value]) => <div className="flex items-start gap-2" key={key}><dt className="shrink-0 text-[var(--muted)]">{label}</dt><dd className="min-w-0 break-all whitespace-pre-wrap">{displayHistoryParameter(value)}</dd></div>)}</dl>
      </details>}
      <div className="replica-history-actions" role="group" aria-label={`第 ${index + 1} 张历史图像操作`}>
        <button type="button" aria-label={`复制第 ${index + 1} 张历史原图`} title={copying ? "正在复制…" : "复制原图"} disabled={copying} onClick={() => void onCopy(item)}><Copy size={16} /></button>
        <button type="button" aria-label={`删除第 ${index + 1} 张历史图像`} title="删除" onClick={() => { setMenuOpen(false); onDelete(index); }}><Trash2 size={16} /></button>
        <button ref={menuButtonRef} type="button" aria-label={`第 ${index + 1} 张历史图像更多操作`} title="更多操作" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId} onClick={() => setMenuOpen((open) => !open)}><Ellipsis size={16} /></button>
      </div>
      {menuOpen && (() => {
        const menu = (
          <div
            className="replica-history-menu"
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="历史图像更多操作"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setMenuOpen(false);
                focusMenuButton();
                return;
              }
              menuKeyboard(event);
            }}
            style={menuPosition ? { top: menuPosition.top, left: menuPosition.left } : { visibility: "hidden" }}
          >
            {[
              ["reuse-parameters", "复用参数"],
              ["img2img", "用于图生图"],
              ["inpainting", "用于局部重绘"],
              ["director-lineart", "用于导演工具"],
              ["vibe-transfer", "用于风格迁移"],
              ["upscale", "用于超分"],
            ].map(([operation, label]) => <button type="button" role="menuitem" key={operation} onClick={() => { setMenuOpen(false); onUse(item, operation); }}>{label}</button>)}
          </div>
        );
        return typeof document === "undefined" ? menu : createPortal(menu, document.body);
      })()}
    </article>
  );
}

export function ReplicaHistory({ items, onOpen, onUse, onDelete }: ReplicaHistoryProps): ReactElement {
  const [copyingImage, setCopyingImage] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  async function copyOriginal(item: ReplicaHistoryItem): Promise<void> {
    setNotice(null);
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      setNotice({ text: "浏览器不支持复制图像，请下载原图。", error: true });
      return;
    }
    setCopyingImage(item.image);
    try {
      const response = await fetch(item.image);
      if (!response.ok) throw new Error("image-fetch");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("image-format");
      if (typeof ClipboardItem.supports === "function" && !ClipboardItem.supports(blob.type)) {
        setNotice({ text: "浏览器不支持复制此图像格式，请下载原图。", error: true });
        return;
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      setNotice({ text: "已复制原图", error: false });
    } catch {
      setNotice({ text: "复制失败，请检查剪贴板权限或下载原图。", error: true });
    } finally {
      setCopyingImage(null);
    }
  }

  return (
    <div data-replica-history>
      {notice && <div className={`replica-history-notice${notice.error ? " is-error" : ""}`} role={notice.error ? "alert" : "status"}>
        <span>{notice.text}</span><button type="button" aria-label="关闭历史提示" onClick={() => setNotice(null)}><X size={14} /></button>
      </div>}
      {items.length ? <div className="replica-history-list">
        {items.map((item, index) => <HistoryCard key={`${item.createdAt}-${index}`} item={item} index={index} copying={copyingImage === item.image} onCopy={copyOriginal} onOpen={onOpen} onUse={onUse} onDelete={onDelete} />)}
      </div> : <div className="replica-history-empty"><History size={48} strokeWidth={2} /><p>暂无历史记录</p></div>}
    </div>
  );
}

export default ReplicaHistory;
