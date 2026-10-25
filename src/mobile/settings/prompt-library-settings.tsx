"use client";

import { BookOpen, KeyRound, Plus, Save, Trash2, Type } from "lucide-react";
import { useEffect, useState } from "react";
import {
  MODEL_QUALITY_TAGS,
  UC_PRESET_LABELS,
  ucPresetContent,
} from "@/lib/nai-quality";

// 提示词预设管理：等级提示词（质量词/UC，用户可覆盖）+ 提示词方法库
// （V5 移植 nai5-prompting / 自写 V4.5）+ 我的词库（自定义引用条目），独立界面。
type ModelTab = "nai-v5-full" | "nai-v4.5-full" | "nai-v4.5-curated";
const MODEL_TABS: Array<{ id: ModelTab; label: string; doc: string }> = [
  { id: "nai-v5-full", label: "V5", doc: "/data/nai5-prompting.md" },
  { id: "nai-v4.5-full", label: "V4.5 Full", doc: "/data/v45-prompting.md" },
  { id: "nai-v4.5-curated", label: "V4.5 Curated", doc: "/data/v45-prompting.md" },
];

const UC_TYPES = ["heavy", "light", "furry-focus", "human-focus", "none"] as const;

const USER_LIBRARY_KEY = "lfn-user-library";
// 与工作台提示词编辑器相同的同步事件：保存后立即生效，无需刷新。
const PROMPT_CONFIG_EVENT = "replica-prompt-config-change";

type UserLibraryEntry = { name: string; content: string };

function readUserLibrary(): UserLibraryEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USER_LIBRARY_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      const content = typeof record.content === "string" ? record.content : "";
      if (!name || !content.trim()) return [];
      return [{ ...(record as UserLibraryEntry), name, content }];
    }).slice(0, 500);
  } catch {
    return [];
  }
}

function writeUserLibrary(entries: UserLibraryEntry[]): void {
  const clean = entries
    .map((entry) => ({ ...entry, name: entry.name.trim().slice(0, 200), content: entry.content.slice(0, 100_000) }))
    .filter((entry) => entry.name && entry.content.trim());
  try {
    if (clean.length) window.localStorage.setItem(USER_LIBRARY_KEY, JSON.stringify(clean));
    else window.localStorage.removeItem(USER_LIBRARY_KEY);
  } catch {
    throw new Error("无法保存词库，请检查浏览器的存储权限。");
  }
  window.dispatchEvent(new CustomEvent(PROMPT_CONFIG_EVENT, { detail: USER_LIBRARY_KEY }));
}

function UserLibraryEditor() {
  const [entries, setEntries] = useState<UserLibraryEntry[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.resolve().then(() => setEntries(readUserLibrary()));
    const sync = () => setEntries(readUserLibrary());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function update(index: number, patch: Partial<UserLibraryEntry>) {
    setEntries((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
    setStatus("");
  }

  function add() {
    setEntries((current) => [...current, { name: "", content: "" }]);
    setStatus("");
  }

  function remove(index: number) {
    setEntries((current) => current.filter((_, i) => i !== index));
    setStatus("");
  }

  function save() {
    setError("");
    try {
      const names = new Set<string>();
      for (const entry of entries) {
        const name = entry.name.trim();
        if (!name) continue;
        if (names.has(name)) {
          setError(`词条「${name}」重复，请修改名称后再保存。`);
          return;
        }
        names.add(name);
      }
      writeUserLibrary(entries);
      setStatus(`已保存 ${entries.filter((entry) => entry.name.trim() && entry.content.trim()).length} 个词条，工作台立即生效。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败。");
      return;
    }
    window.setTimeout(() => setStatus(""), 2500);
  }

  return (
    <article className="panel rounded-md p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen size={17} className="text-[var(--rose)]" />
          <b className="text-sm">我的词库（自定义）</b>
        </div>
        <button type="button" onClick={add} className="flex h-8 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--rose)] hover:border-[var(--rose)]">
          <Plus size={14} />添加词条
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
        自定义引用条目会出现在工作台提示词编辑器的「引用词库 · 我的词库」分类中；输入 <code>&lt;</code> 即可引用，选中后内容按权重插入提示词。名称建议用简短英文，内容可包含逗号分隔的标签或整段描述。
      </p>
      {!entries.length && <p className="mt-3 text-xs text-[var(--muted)]">还没有自定义词条，点击「添加词条」创建。</p>}
      <div className="mt-4 space-y-3">
        {entries.map((entry, index) => (
          <div key={index} className="grid gap-2 rounded border border-[var(--line)] bg-[var(--surface)] p-3 sm:grid-cols-[200px_1fr_auto]">
            <label className="block text-xs font-semibold">
              名称
              <input
                value={entry.name}
                onChange={(event) => update(index, { name: event.target.value })}
                placeholder="例如：雨夜街景"
                maxLength={200}
                className="field mt-1.5 h-9 w-full px-3 text-xs"
              />
            </label>
            <label className="block text-xs font-semibold">
              内容
              <textarea
                value={entry.content}
                onChange={(event) => update(index, { content: event.target.value })}
                placeholder="1girl, rain, night, city lights, wet street, reflection"
                className="field mt-1.5 min-h-16 w-full resize-y p-2 font-mono text-xs"
              />
            </label>
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label={`删除词条 ${entry.name || index + 1}`}
              className="mt-5 grid h-9 w-9 shrink-0 place-items-center self-start rounded border border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--rose)] hover:text-[var(--rose)] sm:mt-7"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} className="flex h-9 items-center gap-2 rounded bg-[var(--rose)] px-4 text-xs font-semibold text-white hover:opacity-90">
          <Save size={14} />保存词库
        </button>
        {status && <span className="text-[10px] text-[var(--rose)]">{status}</span>}
        {error && <span className="text-[10px] text-red-600">{error}</span>}
      </div>
    </article>
  );
}

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
          <UserLibraryEditor />
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
