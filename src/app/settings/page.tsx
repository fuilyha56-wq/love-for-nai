"use client";

import {
  ArrowLeft,
  Check,
  CircleHelp,
  Grid3X3,
  History,
  Image as ImageIcon,
  ImagePlus,
  Palette,
  RotateCcw,
  Sparkles,
  SunMoon,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAppearance } from "@/app/appearance";
import {
  isSafeHexColor,
  type AccentPreset,
  type AppearanceDensity,
  type AppearanceMotion,
  type AppearanceTheme,
  type HexColor,
} from "@/lib/appearance-store";

const themeOptions: Array<{
  value: AppearanceTheme;
  label: string;
  detail: string;
  swatches: string[];
}> = [
  { value: "paper", label: "宣纸", detail: "明亮、温和的默认界面", swatches: ["#f7f6f2", "#fffefa", "#a83a4c"] },
  { value: "dusk", label: "暮色", detail: "暖灰纸张与柔和对比", swatches: ["#eee9e4", "#fffaf5", "#7658a8"] },
  { value: "night", label: "夜间", detail: "低亮度深色工作环境", swatches: ["#17191d", "#22252b", "#b47c2a"] },
];

const accentOptions: Array<{
  value: AccentPreset;
  label: string;
  color: string;
}> = [
  { value: "rose", label: "蔷薇", color: "#a83a4c" },
  { value: "mint", label: "薄荷", color: "#2d7567" },
  { value: "gold", label: "琥珀", color: "#b47c2a" },
  { value: "violet", label: "紫藤", color: "#7658a8" },
];

function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(sourceUrl);
      const maxDimension = 2400;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("浏览器无法创建图片处理画布"));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("图片压缩失败"))),
        "image/jpeg",
        0.82,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error("无法读取这张图片"));
    };
    image.src = sourceUrl;
  });
}

type HistoryImage = {
  id: string;
  createdAt: string;
  imageUrl: string;
  parameters: Record<string, string | number>;
};

// 从历史接口把图片拉成本地 Blob，再走同一套压缩+IndexedDB 落盘。
async function importHistoryBackground(
  item: HistoryImage,
  onProgress: (text: string) => void,
): Promise<Blob> {
  onProgress("正在读取历史图片…");
  const response = await fetch(item.imageUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("历史图片读取失败，请重新登录后重试");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("历史记录不是有效的图片");
  onProgress("正在压缩并保存…");
  return compressImage(new File([blob], "history.png", { type: blob.type }));
}

function HistoryPickerDialog({
  onClose,
  onPick,
  setMessage,
}: {
  onClose: () => void;
  onPick: (item: HistoryImage) => void;
  setMessage: (text: string) => void;
}) {
  const [items, setItems] = useState<HistoryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/history", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as {
          items?: HistoryImage[];
          message?: string;
        };
        if (!response.ok) throw new Error(result.message || "读取历史失败");
        setItems(result.items || []);
      })
      .catch((cause) => {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "读取历史失败");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[30000] grid place-items-center bg-[#202328]/45 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[#fffefa] shadow-[0_24px_80px_rgba(50,45,40,.25)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[#f5f3ed] px-5 py-4">
          <div className="flex items-center gap-2">
            <History size={17} className="text-[var(--rose)]" />
            <b>从历史导入背景</b>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-[var(--muted)]">正在读取历史…</p>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm text-[var(--rose)]">{error}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">需要登录后才能读取生成历史。</p>
            </div>
          ) : items.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPicked(item.id)}
                  className={`group relative overflow-hidden rounded-md border transition-colors ${
                    picked === item.id
                      ? "border-[var(--rose)] ring-2 ring-[var(--rose)]/30"
                      : "border-[var(--line)] hover:border-[var(--rose)]"
                  }`}
                  aria-pressed={picked === item.id}
                >
                  <span className="block aspect-[4/5] bg-[#ebe9e2]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.imageUrl}
                      alt={item.parameters.prompt ? String(item.parameters.prompt).slice(0, 40) : "历史生成图片"}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </span>
                  {picked === item.id && (
                    <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[var(--rose)] text-white" aria-hidden="true">
                      <Check size={13} strokeWidth={3} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center">
              <ImageIcon size={30} className="mx-auto text-[var(--muted)]" />
              <p className="mt-3 text-sm text-[var(--muted)]">还没有生成历史，先去工作台生成几张图吧。</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--line)] bg-[#f5f3ed] px-5 py-3.5">
          <button type="button" onClick={onClose} className="h-9 rounded border border-[var(--line)] bg-white px-4 text-sm font-semibold">
            取消
          </button>
          <button
            type="button"
            disabled={!picked}
            onClick={() => {
              const item = items.find((entry) => entry.id === picked);
              if (!item) {
                setMessage("请先选择一张历史图片");
                return;
              }
              onPick(item);
            }}
            className="flex h-9 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            使用这张
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingHeading({
  icon,
  eyebrow,
  title,
  detail,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[color-mix(in_srgb,var(--rose)_10%,transparent)] text-[var(--rose)]">
        {icon}
      </span>
      <div>
        <p className="text-[10px] font-bold tracking-[0.16em] text-[var(--rose)]">{eyebrow}</p>
        <h2 className="mt-1 text-base font-semibold">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{detail}</p>
      </div>
    </div>
  );
}

function ChoiceButton({
  selected,
  onClick,
  children,
  className = "",
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`relative rounded-md border px-3 py-3 text-left transition-colors ${
        selected
          ? "border-[var(--rose)] bg-[color-mix(in_srgb,var(--rose)_8%,transparent)]"
          : "border-[var(--line)] bg-white hover:border-[var(--rose)]"
      } ${className}`}
    >
      {selected && (
        <span className="absolute right-2 top-2 text-[var(--rose)]" aria-hidden="true">
          <Check size={14} strokeWidth={2.5} />
        </span>
      )}
      {children}
    </button>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-left"
    >
      <span
        className={`relative h-6 w-11 rounded-full p-0.5 transition-colors ${
          checked ? "bg-[var(--rose)]" : "bg-[#c9c8c2]"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
      <span className="text-sm font-semibold">{label}</span>
    </button>
  );
}

function SettingsPageContent() {
  const {
    preferences,
    updatePreferences,
    resetPreferences,
    backgroundUrl,
    hasBackground,
    ready,
    saveBackground,
    removeBackground,
  } = useAppearance();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
  const [customAccentInput, setCustomAccentInput] = useState(
    preferences.customAccent || "",
  );
  const [lastSyncedAccent, setLastSyncedAccent] = useState(
    preferences.customAccent,
  );
  if (preferences.customAccent !== lastSyncedAccent) {
    setLastSyncedAccent(preferences.customAccent);
    setCustomAccentInput(preferences.customAccent || "");
  }

  function setCustomAccent(value: string) {
    setCustomAccentInput(value);
    if (isSafeHexColor(value)) {
      updatePreferences({ customAccent: value.toUpperCase() as HexColor });
      setMessage("");
    } else if (value === "") {
      updatePreferences({ customAccent: null });
      setMessage("");
    }
  }

  async function onBackgroundChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("请选择图片文件。");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setMessage("图片不能超过 20 MB。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const compressed = await compressImage(file);
      await saveBackground(compressed);
      setMessage("背景已压缩并保存在本机浏览器中，不会上传服务器。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "背景保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function clearBackground() {
    setBusy(true);
    setMessage("");
    try {
      await removeBackground();
      setMessage("本地背景已清除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "背景清除失败");
    } finally {
      setBusy(false);
    }
  }

  async function importFromHistory(item: HistoryImage) {
    setShowHistoryPicker(false);
    setBusy(true);
    setMessage("");
    try {
      const blob = await importHistoryBackground(item, setMessage);
      await saveBackground(blob);
      updatePreferences({ backgroundEnabled: true });
      setMessage("已从历史导入背景，保存在本机浏览器中，不会上传服务器。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "历史背景导入失败");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    resetPreferences();
    setCustomAccentInput("");
    setMessage("外观偏好已恢复默认值。");
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--panel)]/95 px-4 backdrop-blur sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <Palette size={20} className="shrink-0 text-[var(--rose)]" />
          <div className="min-w-0">
            <b className="block truncate">外观偏好</b>
            <span className="hidden text-[10px] text-[var(--muted)] sm:block">APPEARANCE · 仅保存在本机</span>
          </div>
        </div>
        <Link
          href="/image"
          className="flex h-9 shrink-0 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-sm font-semibold hover:border-[var(--rose)]"
        >
          <ArrowLeft size={16} /> 返回工作台
        </Link>
      </header>

      <section className="mx-auto max-w-5xl space-y-6 p-4 sm:p-7">
        {!ready && (
          <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)]">
            正在恢复本机外观偏好…
          </div>
        )}
        {message && (
          <div className="rounded-md border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
            {message}
          </div>
        )}

        <article className="panel rounded-md p-5 sm:p-6">
          <SettingHeading
            icon={<SunMoon size={18} />}
            eyebrow="THEME · 主题"
            title="选择工作环境"
            detail="主题只影响当前浏览器，不会改变账号或作品数据。"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {themeOptions.map((option) => (
              <ChoiceButton
                key={option.value}
                selected={preferences.theme === option.value}
                onClick={() => updatePreferences({ theme: option.value })}
              >
                <span className="mb-3 flex gap-1.5" aria-hidden="true">
                  {option.swatches.map((color) => (
                    <i key={color} className="h-7 w-7 rounded-full border border-black/10" style={{ backgroundColor: color }} />
                  ))}
                </span>
                <b className="block text-sm">{option.label}</b>
                <span className="mt-1 block text-[11px] text-[var(--muted)]">{option.detail}</span>
              </ChoiceButton>
            ))}
          </div>
        </article>

        <article className="panel rounded-md p-5 sm:p-6">
          <SettingHeading
            icon={<Sparkles size={18} />}
            eyebrow="ACCENT · 强调色"
            title="让界面更像你的工作台"
            detail="选择一个预设，或输入安全的六位十六进制颜色。"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {accentOptions.map((option) => (
              <ChoiceButton
                key={option.value}
                selected={!preferences.customAccent && preferences.accentPreset === option.value}
                      onClick={() => {
                        updatePreferences({ accentPreset: option.value, customAccent: null });
                        setCustomAccentInput("");
                      }}
                className="flex items-center gap-3"
              >
                <i className="h-8 w-8 shrink-0 rounded-full shadow-inner" style={{ backgroundColor: option.color }} />
                <span>
                  <b className="block text-sm">{option.label}</b>
                  <span className="text-[10px] uppercase text-[var(--muted)]">{option.color}</span>
                </span>
              </ChoiceButton>
            ))}
          </div>
          <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <label className="block text-xs font-semibold" htmlFor="custom-accent">
              自定义强调色
              <input
                id="custom-accent"
                className="field mt-2 w-full px-3 font-mono text-sm uppercase"
                value={customAccentInput}
                onChange={(event) => setCustomAccent(event.target.value.trim())}
                placeholder="#A83A4C"
                maxLength={7}
                spellCheck={false}
              />
            </label>
            <span
              className="block h-10 w-full rounded border border-[var(--line)] sm:w-14"
              style={{
                backgroundColor:
                  customAccentInput && isSafeHexColor(customAccentInput)
                    ? customAccentInput
                    : (accentOptions.find((option) => option.value === preferences.accentPreset)?.color ?? "#a83a4c"),
              }}
              aria-hidden="true"
            />
            <label
              className="grid h-10 w-full cursor-pointer place-items-center overflow-hidden rounded border border-[var(--line)] bg-white text-xs font-semibold text-[var(--muted)] hover:border-[var(--rose)] sm:w-14"
              title="打开取色器"
            >
              取色
              <input
                type="color"
                value={
                  customAccentInput && isSafeHexColor(customAccentInput)
                    ? customAccentInput
                    : (accentOptions.find((option) => option.value === preferences.accentPreset)?.color ?? "#a83a4c")
                }
                onChange={(event) => setCustomAccent(event.target.value)}
                className="sr-only"
                aria-label="选择自定义强调色"
              />
            </label>
          </div>
          {customAccentInput && !isSafeHexColor(customAccentInput) && (
            <p className="mt-2 text-xs text-[var(--rose)]">请输入格式为 #RRGGBB 的颜色。</p>
          )}
        </article>

        <div className="grid gap-5 lg:grid-cols-2">
          <article className="panel rounded-md p-5 sm:p-6">
            <SettingHeading
              icon={<Grid3X3 size={18} />}
              eyebrow="LAYOUT · 布局"
              title="阅读与空间"
              detail="在大屏和移动设备上都保持清晰的间距。"
            />
            <div className="mt-5 space-y-5">
              <Switch
                checked={preferences.grid}
                onChange={(grid) => updatePreferences({ grid })}
                label="显示纸张网格"
              />
              <div>
                <p className="mb-2 text-xs font-semibold">内容密度</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["comfortable", "compact"] as AppearanceDensity[]).map((density) => (
                    <ChoiceButton
                      key={density}
                      selected={preferences.density === density}
                      onClick={() => updatePreferences({ density })}
                      className="py-2.5"
                    >
                      <b className="text-xs">{density === "comfortable" ? "舒适" : "紧凑"}</b>
                      <span className="mt-1 block text-[10px] text-[var(--muted)]">
                        {density === "comfortable" ? "更多呼吸空间" : "一次查看更多内容"}
                      </span>
                    </ChoiceButton>
                  ))}
                </div>
              </div>
            </div>
          </article>

          <article className="panel rounded-md p-5 sm:p-6">
            <SettingHeading
              icon={<WandSparkles size={18} />}
              eyebrow="MOTION · 动效"
              title="控制界面反馈"
              detail="减少动效会关闭过渡动画，适合对动态敏感的使用场景。"
            />
            <div className="mt-5 grid grid-cols-2 gap-2">
              {(["full", "reduced"] as AppearanceMotion[]).map((motion) => (
                <ChoiceButton
                  key={motion}
                  selected={preferences.motion === motion}
                  onClick={() => updatePreferences({ motion })}
                  className="py-3"
                >
                  <b className="text-xs">{motion === "full" ? "完整动效" : "减少动效"}</b>
                  <span className="mt-1 block text-[10px] text-[var(--muted)]">
                    {motion === "full" ? "保留界面过渡" : "降低动态反馈"}
                  </span>
                </ChoiceButton>
              ))}
            </div>
          </article>
        </div>

        <article className="panel rounded-md p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SettingHeading
              icon={<Sparkles size={18} />}
              eyebrow="GLASS · 液态玻璃"
              title="轻盈的半透明面板"
              detail="默认关闭。开启后只改变本地界面的面板透明度与模糊强度。"
            />
            <Switch
              checked={preferences.glass}
              onChange={(glass) => updatePreferences({ glass })}
              label={preferences.glass ? "已开启" : "已关闭"}
            />
          </div>
          <div className={`mt-5 rounded-md border border-[var(--line)] p-4 ${preferences.glass ? "bg-white/40" : "bg-black/[0.025]"}`}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <label htmlFor="glass-strength" className="font-semibold">玻璃强度</label>
              <output htmlFor="glass-strength" className="font-mono text-[var(--rose)]">{preferences.glassStrength}%</output>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-[var(--muted)]">0% 起就有液态玻璃感（模糊 + 半透明 + 高光），强度继续增强模糊与通透度。</p>
            <input
              id="glass-strength"
              type="range"
              min="0"
              max="100"
              step="1"
              value={preferences.glassStrength}
              onChange={(event) => updatePreferences({ glassStrength: Number(event.target.value) })}
              disabled={!preferences.glass}
              className="range mt-3 w-full disabled:opacity-40"
            />
          </div>
        </article>

        <article className="panel overflow-hidden rounded-md p-5 sm:p-6">
          <SettingHeading
            icon={<ImagePlus size={18} />}
            eyebrow="LOCAL BACKGROUND · 本地背景"
            title="把喜欢的画面带进工作台"
            detail="图片会在浏览器中压缩后保存到 IndexedDB，绝不会上传到服务器。"
          />
          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                  className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-xs font-semibold text-white hover:bg-[var(--rose-dark)] disabled:opacity-50"
                >
                  <Upload size={15} /> {busy ? "处理中…" : "上传背景"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowHistoryPicker(true)}
                  disabled={busy}
                  className="flex h-10 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--rose)] hover:border-[var(--rose)] disabled:opacity-50"
                >
                  <History size={15} /> 从历史导入
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  onChange={onBackgroundChange}
                  className="hidden"
                  aria-label="上传本地背景图片"
                />
                <Switch
                  checked={preferences.backgroundEnabled && hasBackground}
                  onChange={(backgroundEnabled) => updatePreferences({ backgroundEnabled })}
                  label="启用背景"
                />
                {hasBackground && (
                  <button
                    type="button"
                    onClick={clearBackground}
                    disabled={busy}
                    className="flex h-10 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--rose)] hover:border-[var(--rose)] disabled:opacity-50"
                  >
                    <Trash2 size={14} /> 清除
                  </button>
                )}
              </div>
              <div className="mt-4 rounded-md border border-[var(--line)] bg-[#faf9f5] p-4">
                <p className="mb-3 text-xs font-semibold">背景位置</p>
                <div className="space-y-4">
                  <label className="block text-xs text-[var(--muted)]">
                    <span className="flex items-center justify-between">
                      <span>左右（左 ← → 右）</span>
                      <output className="font-mono text-[var(--rose)]">{preferences.backgroundPositionX}%</output>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={preferences.backgroundPositionX}
                      onChange={(event) => updatePreferences({ backgroundPositionX: Number(event.target.value) })}
                      className="range mt-2 w-full"
                      aria-label="背景水平位置"
                    />
                  </label>
                  <label className="block text-xs text-[var(--muted)]">
                    <span className="flex items-center justify-between">
                      <span>高低（上 ↑ ↓ 下）</span>
                      <output className="font-mono text-[var(--rose)]">{preferences.backgroundPositionY}%</output>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={preferences.backgroundPositionY}
                      onChange={(event) => updatePreferences({ backgroundPositionY: Number(event.target.value) })}
                      className="range mt-2 w-full"
                      aria-label="背景垂直位置"
                    />
                  </label>
                </div>
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-[var(--muted)]">
                <CircleHelp size={13} className="mt-0.5 shrink-0" /> 支持 JPG、PNG、WebP 等图片，最大 20 MB；保存前会缩放到最长边 2400px。
              </p>
            </div>
            <div className="relative aspect-[16/9] overflow-hidden rounded-md border border-[var(--line)] bg-[#e9e6de]">
              {backgroundUrl ? (
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${backgroundUrl}")` }} aria-label="当前本地背景预览" />
              ) : (
                <div className="absolute inset-0 grid place-items-center p-4 text-center text-[11px] text-[var(--muted)]">尚未保存本地背景</div>
              )}
              {backgroundUrl && !preferences.backgroundEnabled && (
                <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white">预览 · 未启用</span>
              )}
            </div>
          </div>
        </article>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
          <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <CircleHelp size={13} /> 所有偏好仅存于此浏览器的本地存储。
          </p>
          <button
            type="button"
            onClick={reset}
            className="flex h-9 items-center gap-2 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold hover:border-[var(--rose)] hover:text-[var(--rose)]"
          >
            <RotateCcw size={14} /> 恢复默认
          </button>
        </div>
      </section>
      {showHistoryPicker && (
        <HistoryPickerDialog
          onClose={() => setShowHistoryPicker(false)}
          onPick={importFromHistory}
          setMessage={setMessage}
        />
      )}
    </main>
  );
}

export default function SettingsPage() {
  return <SettingsPageContent />;
}
