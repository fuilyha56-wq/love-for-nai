"use client";

import { BookOpen, KeyRound, Save, Type } from "lucide-react";
import { useEffect, useState } from "react";
import {
  MODEL_QUALITY_TAGS,
  UC_PRESET_LABELS,
  ucPresetContent,
} from "@/lib/nai-quality";

// 提示词预设管理：等级提示词（质量词/UC，用户可覆盖）+ 提示词方法库
// （V5 移植 nai5-prompting / 自写 V4.5），独立界面。
type ModelTab = "nai-v5-full" | "nai-v4.5-full" | "nai-v4.5-curated";
const MODEL_TABS: Array<{ id: ModelTab; label: string; doc: string }> = [
  { id: "nai-v5-full", label: "V5", doc: "/data/nai5-prompting.md" },
  { id: "nai-v4.5-full", label: "V4.5 Full", doc: "/data/v45-prompting.md" },
  { id: "nai-v4.5-curated", label: "V4.5 Curated", doc: "/data/v45-prompting.md" },
];

const UC_TYPES = ["heavy", "light", "furry-focus", "human-focus", "none"] as const;

export default function PromptLibrarySettings() {
  const [modelTab, setModelTab] = useState<ModelTab>("nai-v5-full");
  const [docText, setDocText] = useState("加载中…");
  const [customQuality, setCustomQuality] = useState("");
  const [customUc, setCustomUc] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setCustomQuality(window.localStorage.getItem("lfn-quality-custom") || "");
      setCustomUc(window.localStorage.getItem("lfn-uc-custom") || "");
    });
  }, []);

  useEffect(() => {
    const doc = MODEL_TABS.find((item) => item.id === modelTab)?.doc || "";
    fetch(doc, { cache: "force-cache" })
      .then((response) => response.text())
      .then((text) => setDocText(text))
      .catch(() => setDocText("方法库加载失败，请稍后重试。"));
  }, [modelTab]);

  function save() {
    if (customQuality.trim()) window.localStorage.setItem("lfn-quality-custom", customQuality.trim());
    else window.localStorage.removeItem("lfn-quality-custom");
    if (customUc.trim()) window.localStorage.setItem("lfn-uc-custom", customUc.trim());
    else window.localStorage.removeItem("lfn-uc-custom");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  const current = MODEL_TABS.find((item) => item.id === modelTab);

  return (
    <div className="space-y-6">
          <article className="panel rounded-md p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <KeyRound size={17} className="text-[var(--rose)]" />
              <b className="text-sm">自定义内置提示词</b>
              {saved && <span className="text-[10px] text-[var(--rose)]">已保存，工作台立即生效</span>}
            </div>
            <p className="mt-1.5 text-xs text-[var(--muted)]">
              保存后在工作台「质量词 / 负面预设」下拉中选择「自定义」即可使用。
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <label className="block text-xs font-semibold">
                自定义质量词（追加到提示词末尾）
                <textarea
                  value={customQuality}
                  onChange={(event) => setCustomQuality(event.target.value)}
                  placeholder="very aesthetic, masterpiece, no text"
                  className="field mt-2 min-h-20 w-full resize-y p-2 font-mono text-xs"
                />
              </label>
              <label className="block text-xs font-semibold">
                自定义 UC 负面预设（添加到排除内容前缀）
                <textarea
                  value={customUc}
                  onChange={(event) => setCustomUc(event.target.value)}
                  placeholder="lowres, worst quality, bad quality, very displeasing"
                  className="field mt-2 min-h-20 w-full resize-y p-2 font-mono text-xs"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={save}
              className="mt-4 flex h-9 items-center gap-2 rounded bg-[var(--rose)] px-4 text-xs font-semibold text-white hover:opacity-90"
            >
              <Save size={14} />保存
            </button>
          </article>

          <article className="panel rounded-md p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Type size={17} className="text-[var(--rose)]" />
                <b className="text-sm">内置提示词（官方默认）</b>
              </div>
              <div className="flex gap-1 rounded-md border border-[var(--line)] bg-[var(--surface)] p-1 text-xs font-semibold">
                {MODEL_TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setModelTab(item.id)}
                    className={`h-7 rounded px-3 ${modelTab === item.id ? "bg-[var(--panel)] text-[var(--rose)] shadow-sm" : "text-[var(--muted)]"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 space-y-2 text-xs">
              <div className="flex gap-2 rounded border border-[var(--line)] bg-[var(--surface)] p-3">
                <b className="shrink-0">质量词</b>
                <code className="font-mono text-[var(--muted)]">{MODEL_QUALITY_TAGS[current?.id || "nai-v5-full"]}</code>
              </div>
              {UC_TYPES.map((type) => (
                <div key={type} className="flex gap-2 rounded border border-[var(--line)] bg-[var(--surface)] p-3">
                  <b className="shrink-0">UC · {UC_PRESET_LABELS[type]}</b>
                  <code className="break-all font-mono text-[var(--muted)]">{ucPresetContent(current?.id || "nai-v5-full", type) || "（空）"}</code>
                </div>
              ))}
            </div>
          </article>

          <article className="panel rounded-md p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <BookOpen size={17} className="text-[var(--rose)]" />
              <b className="text-sm">提示词方法库 · {current?.label}</b>
              <span className="text-[10px] text-[var(--muted)]">
                V5 移植自 nai5-prompting（GPL-3.0）；V4.5 为 LFN 按 V5 方法改写
              </span>
            </div>
            <pre className="mt-4 max-h-[560px] overflow-y-auto whitespace-pre-wrap rounded border border-[var(--line)] bg-[var(--surface)] p-4 text-xs leading-6 text-[var(--ink)]">{docText}</pre>
          </article>
    </div>
  );
}
