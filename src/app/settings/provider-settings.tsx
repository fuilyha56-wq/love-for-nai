"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ImageProviderProtocol } from "@/lib/image-model-capabilities";
import { PopupSelect } from "@/app/ui/popup-select";
import {
  BookOpen,
  CircleCheck,
  CircleHelp,
  KeyRound,
  Layers3,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

type ProviderCapability = "image" | "story";
type CapabilityChoice = ProviderCapability | "both";

type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  storyModel?: string;
  kind?: "openai" | "novelai";
  capabilities: ProviderCapability[];
  source: "providers" | "story-providers";
  protocol?: ImageProviderProtocol;
  hasKey: boolean;
  createdAt?: string;
};

type DiscoveredModel = { id: string; kind: string };
type Account = { tier?: number; active?: boolean; expiresAt?: number; anlas?: number; contextTokens?: number; priority?: number; nextRefillAt?: number; banStatus?: string };
type ProviderResult = { items?: unknown; item?: unknown; message?: string; capabilities?: unknown; supportsStoryProviders?: boolean };

type NovelAiAccount = {
  connected: boolean;
  tier: number | null;
  active: boolean | null;
  anlas: { fixed: number; purchased: number; total: number } | null;
  usage: {
    percent: number;
    isNegative: boolean;
    timeUntilNextPercent: number;
  } | null;
  expiresAt: number | null;
};

const tierNames: Record<number, string> = {
  0: "Paper（免费）",
  1: "Tablet",
  2: "Scroll",
  3: "Opus",
};

function modelIds(value: string): string[] {
  return [...new Set(value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean))];
}

function capabilityChoice(value: unknown): CapabilityChoice | null {
  if (value === "both") return "both";
  if (value === "image" || value === "story" || value === "text") return value === "text" ? "story" : value;
  if (Array.isArray(value)) {
    const values = value.map((item) => item === "text" ? "story" : item).filter((item): item is ProviderCapability => item === "image" || item === "story");
    if (values.includes("image") && values.includes("story")) return "both";
    return values[0] || null;
  }
  return null;
}

function normalizeProvider(item: unknown, source: Provider["source"]): Provider | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.name !== "string") return null;
  const modelEntries = Array.isArray(value.modelEntries) ? value.modelEntries : [];
  const entryCapabilities = modelEntries.map((entry) => entry && typeof entry === "object" ? capabilityChoice((entry as Record<string, unknown>).capabilities) : null).filter((item): item is CapabilityChoice => item !== null);
  const explicit = capabilityChoice(value.capabilities) || capabilityChoice(value.capability);
  const isStory = value.kind === "openai" || value.kind === "novelai" || typeof value.model === "string";
  const selected = explicit || (entryCapabilities.includes("both") || entryCapabilities.includes("image") && entryCapabilities.includes("story") ? "both" : entryCapabilities[0]) || (isStory ? "story" : "image");
  const capabilities: ProviderCapability[] = selected === "both" ? ["image", "story"] : [selected];
  const models = Array.isArray(value.models)
    ? value.models.filter((model): model is string => typeof model === "string")
    : modelEntries
      .filter((entry) => entry && typeof entry === "object" && capabilityChoice((entry as Record<string, unknown>).capabilities) !== "story")
      .map((entry) => (entry as Record<string, unknown>).id)
      .filter((model): model is string => typeof model === "string");
  const storyEntry = modelEntries.find((entry) => entry && typeof entry === "object" && ["story", "both"].includes(capabilityChoice((entry as Record<string, unknown>).capabilities) || ""));
  const storyModel = typeof value.model === "string" ? value.model : storyEntry && typeof storyEntry === "object" && typeof (storyEntry as Record<string, unknown>).id === "string" ? (storyEntry as Record<string, unknown>).id as string : undefined;
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl : "";
  const kind = value.kind === "openai" || value.kind === "novelai" ? value.kind : /text\.novelai\.net/i.test(baseUrl) ? "novelai" : undefined;
  return {
    id: value.id,
    name: value.name,
    baseUrl,
    models: [...new Set(models)],
    storyModel,
    kind,
    capabilities,
    source,
    protocol: value.protocol === "auto" || value.protocol === "openai-images" || value.protocol === "gemini" ? value.protocol : undefined,
    hasKey: value.hasKey === true,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
  };
}

function capabilityLabel(capabilities: ProviderCapability[]): string {
  if (capabilities.includes("image") && capabilities.includes("story")) return "图像 + 故事";
  return capabilities.includes("story") ? "故事模型" : "图像模型";
}

/** 手动模型 ID 的产品分类标签（仅用于展示，不做能力判断）。 */
function manualTag(id: string): string {
  if (/^nai-/i.test(id)) return "NAI";
  if (/^(?:gemini-|nano[-_ ]?banana)/i.test(id)) return "Nano Banana";
  if (/^(?:gpt-image|chatgpt-image)/i.test(id)) return "GPT";
  return "自定义";
}

function formatExpiry(value: number | null): string {
  if (!value || !Number.isFinite(value)) return "未提供";
  const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return "未提供";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "未知";
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  return `${Math.ceil(seconds / 60)} 分钟`;
}

async function readJson<T>(response: Response): Promise<T> {
  const result = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(result.message || (response.status === 401 ? "请先登录后再管理自己的模型。" : "请求失败，请稍后重试。"));
  }
  return result;
}

function Heading({
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

function Notice({ message, error = false }: { message: string; error?: boolean }) {
  if (!message) return null;
  return (
    <p
      role={error ? "alert" : "status"}
      className={`rounded-md border px-3 py-2 text-xs leading-5 ${error
        ? "border-[color-mix(in_srgb,var(--rose)_35%,var(--line))] bg-[color-mix(in_srgb,var(--rose)_7%,var(--panel))] text-[var(--rose)]"
        : "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--muted)]"}`}
    >
      {message}
    </p>
  );
}

export default function ProviderSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState("");
  const [providersMessage, setProvidersMessage] = useState("");
  const [providerBusy, setProviderBusy] = useState("");
  const [providerName, setProviderName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [manualModels, setManualModels] = useState("");
  const [protocol, setProtocol] = useState<ImageProviderProtocol>("auto");
  const [capability, setCapability] = useState<CapabilityChoice>("image");
  const [storyKind, setStoryKind] = useState<"openai" | "novelai">("openai");
  const [storyModel, setStoryModel] = useState("");
  const [storyAccounts, setStoryAccounts] = useState<Record<string, Account>>({});
  const [editingStoryId, setEditingStoryId] = useState("");
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, DiscoveredModel[]>>({});
  const [discoveryWarning, setDiscoveryWarning] = useState<Record<string, string>>({});
  const [account, setAccount] = useState<NovelAiAccount | null>(null);
  const [novelAiKeySaved, setNovelAiKeySaved] = useState(false);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [novelAiKey, setNovelAiKey] = useState("");
  const [editingNovelAi, setEditingNovelAi] = useState(false);

  // 手动模型 ID 的实时预览：逗号/换行分隔，逐条显示所属产品分类。
  const manualList = useMemo(
    () => manualModels.split(/[\n,]/).map((id) => id.trim()).filter(Boolean),
    [manualModels],
  );

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProvidersError("");
    try {
      const result = await readJson<ProviderResult>(await fetch("/api/providers", { cache: "no-store" }));
      const merged = Array.isArray(result.items)
        ? result.items.map((item) => normalizeProvider(item, "providers")).filter((item): item is Provider => item !== null)
        : [];
      // Older deployments expose story sources separately. Only use that endpoint when the unified response has none.
      if (!merged.some((item) => item.capabilities.includes("story"))) {
        const storyResult = await readJson<ProviderResult>(await fetch("/api/story-providers", { cache: "no-store" }));
        const stories = Array.isArray(storyResult.items)
          ? storyResult.items.map((item) => normalizeProvider(item, "story-providers")).filter((item): item is Provider => item !== null)
          : [];
        merged.push(...stories);
      }
      setProviders(merged);
    } catch (cause) {
      setProvidersError(cause instanceof Error ? cause.message : "读取接口失败。");
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  const loadAccount = useCallback(async () => {
    setAccountLoading(true);
    setAccountError("");
    try {
      const result = await readJson<{ account: NovelAiAccount | null; keySaved?: boolean; error?: string }>(
        await fetch("/api/providers/novelai", { cache: "no-store" }),
      );
      setAccount(result.account || null);
      setNovelAiKeySaved(Boolean(result.keySaved || result.account));
      if (result.error) setAccountError(result.error);
    } catch (cause) {
      setAccountError(cause instanceof Error ? cause.message : "读取 NovelAI 账号失败。");
    } finally {
      setAccountLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => Promise.all([loadProviders(), loadAccount()]));
  }, [loadAccount, loadProviders]);

  async function addProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProvidersError("");
    setProvidersMessage("");
    setProviderBusy("create");
    try {
      if (capability === "story") {
        const storyPayload = {
          id: editingStoryId || undefined,
          name: providerName.trim(),
          kind: storyKind,
          baseUrl: storyKind === "novelai" ? "https://text.novelai.net" : baseUrl.trim(),
          model: storyModel.trim(),
          key: apiKey.trim(),
        };
        let result: ProviderResult;
        let source: Provider["source"] = "providers";
        try {
          if (storyKind === "novelai" || editingStoryId) throw new Error("使用兼容故事模型源接口");
          result = await readJson<ProviderResult>(await fetch("/api/providers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: storyPayload.id,
              name: storyPayload.name,
              baseUrl: storyPayload.baseUrl,
              apiKey: storyPayload.key,
              capability: "text",
              modelEntries: [{ id: storyPayload.model, capabilities: "text" }],
            }),
          }));
        } catch {
          // Older deployments have not merged story providers into /api/providers yet.
          source = "story-providers";
          result = await readJson<ProviderResult>(await fetch("/api/story-providers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(storyPayload),
          }));
        }
        const item = normalizeProvider(result.item, source);
        if (!item) throw new Error("保存接口返回的数据无效");
        setProviders((current) => [item, ...current.filter((entry) => !(entry.id === item.id && entry.source === item.source))]);
        setProvidersMessage(`已保存「${item.name}」。可在故事工作台的模型菜单中选择。`);
      } else {
        const result = await readJson<ProviderResult>(await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: providerName.trim(),
            baseUrl: baseUrl.trim(),
            apiKey: apiKey.trim(),
            models: modelIds(manualModels),
            protocol,
            capabilities: capability === "both" ? ["image", "story"] : ["image"],
          }),
        }));
        const item = normalizeProvider(result.item, "providers");
        if (!item) throw new Error("保存接口返回的数据无效");
        setProviders((current) => [...current, item]);
        setProvidersMessage(`已保存「${item.name}」。可在生图工作台的模型菜单中选择。`);
      }
      setProviderName("");
      setBaseUrl("");
      setApiKey("");
      setManualModels("");
      setStoryModel("");
      setEditingStoryId("");
      setProtocol("auto");
      setCapability("image");
    } catch (cause) {
      setProvidersError(cause instanceof Error ? cause.message : "保存接口失败。");
    } finally {
      setProviderBusy("");
    }
  }

  async function removeProvider(provider: Provider) {
    if (!window.confirm(`删除「${provider.name}」？此操作会移除保存的 API key。`)) return;
    setProvidersError("");
    setProvidersMessage("");
    setProviderBusy(provider.id);
    try {
      const endpoint = provider.source === "story-providers" ? "/api/story-providers" : "/api/providers";
      await readJson<{ ok?: true; success?: true }>(await fetch(`${endpoint}?id=${encodeURIComponent(provider.id)}`, { method: "DELETE" }));
      setProviders((current) => current.filter((item) => item.id !== provider.id));
      setStoryAccounts((current) => { const next = { ...current }; delete next[provider.id]; return next; });
      setProvidersMessage(`已删除「${provider.name}」。`);
    } catch (cause) {
      setProvidersError(cause instanceof Error ? cause.message : "删除接口失败。");
    } finally {
      setProviderBusy("");
    }
  }

  async function readStoryAccount(provider: Provider) {
    setProviderBusy(provider.id);
    setProvidersError("");
    try {
      const result = await readJson<Account>(await fetch(`/api/story-providers/${encodeURIComponent(provider.id)}/account`, { cache: "no-store" }));
      setStoryAccounts((current) => ({ ...current, [provider.id]: result }));
    } catch (cause) {
      setProvidersError(cause instanceof Error ? cause.message : "账号读取失败。");
    } finally {
      setProviderBusy("");
    }
  }

  function editStoryProvider(provider: Provider) {
    setCapability("story");
    setEditingStoryId(provider.id);
    setStoryKind(provider.kind || "openai");
    setProviderName(provider.name);
    setBaseUrl(provider.kind === "novelai" ? "" : provider.baseUrl);
    setStoryModel(provider.storyModel || "");
    setApiKey("");
  }

  async function discoverModels(provider: Provider) {
    setProviderBusy(provider.id);
    setProvidersError("");
    try {
      const result = await readJson<{ items: DiscoveredModel[]; warning?: string }>(
        await fetch(`/api/providers/models?providerId=${encodeURIComponent(provider.id)}`, { cache: "no-store" }),
      );
      setDiscoveredModels((current) => ({ ...current, [provider.id]: Array.isArray(result.items) ? result.items : [] }));
      setDiscoveryWarning((current) => ({ ...current, [provider.id]: result.warning || "" }));
    } catch (cause) {
      setProvidersError(cause instanceof Error ? cause.message : "读取模型失败。");
    } finally {
      setProviderBusy("");
    }
  }

  async function saveNovelAi(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountBusy(true);
    setAccountError("");
    setAccountMessage("");
    try {
      const result = await readJson<{ account: NovelAiAccount }>(await fetch("/api/providers/novelai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: novelAiKey.trim() }),
      }));
      setAccount(result.account);
      setNovelAiKeySaved(true);
      setNovelAiKey("");
      setEditingNovelAi(false);
      setAccountMessage("NovelAI key 已验证并保存；现在可以在生图工作台选择 NovelAI 官方模型。");
    } catch (cause) {
      setAccountError(cause instanceof Error ? cause.message : "导入 NovelAI key 失败。");
    } finally {
      setAccountBusy(false);
    }
  }

  async function removeNovelAi() {
    if (!window.confirm("移除 NovelAI key？需要重新导入才能继续使用官方账号。")) return;
    setAccountBusy(true);
    setAccountError("");
    setAccountMessage("");
    try {
      await readJson<{ ok: true }>(await fetch("/api/providers/novelai", { method: "DELETE" }));
      setAccount(null);
      setNovelAiKeySaved(false);
      setNovelAiKey("");
      setEditingNovelAi(false);
      setAccountMessage("NovelAI key 已移除。");
    } catch (cause) {
      setAccountError(cause instanceof Error ? cause.message : "移除 NovelAI key 失败。");
    } finally {
      setAccountBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <article className="panel rounded-md p-5 sm:p-6" id="custom-providers">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Heading
            icon={<Layers3 size={18} />}
            eyebrow="MODEL SOURCES · 模型来源"
            title="管理模型来源"
            detail="统一管理图像与故事模型来源；列表会标记图像、故事或两者能力。"
          />
          <button
            type="button"
            onClick={() => void loadProviders()}
            disabled={providersLoading}
            className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--muted)] hover:border-[var(--rose)] disabled:opacity-50"
          >
            <RefreshCw size={13} /> 刷新
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {providersLoading ? (
            <p className="text-xs text-[var(--muted)]">正在读取已保存的接口…</p>
          ) : providers.length ? (
            providers.map((provider) => {
              const discovered = discoveredModels[provider.id];
              return (
                <div key={`${provider.source}:${provider.id}`} className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {provider.name}
                        <span className="inline-flex items-center gap-1 rounded bg-[color-mix(in_srgb,var(--mint)_10%,var(--surface))] px-2 py-0.5 text-[10px] font-semibold text-[var(--mint)]">
                          <CircleCheck size={11} /> 已保存 key
                        </span>
                        <span className="inline-flex items-center gap-1 rounded border border-[var(--line)] px-2 py-0.5 text-[10px] font-semibold">
                          {provider.capabilities.includes("story") ? <BookOpen size={11} /> : <Layers3 size={11} />}
                          {capabilityLabel(provider.capabilities)}
                        </span>
                      </p>
                      <p className="mt-1 break-all font-mono text-[11px] text-[var(--muted)]">{provider.kind === "novelai" ? "NovelAI 官方直连" : provider.baseUrl || "统一模型来源"}</p>
                      <p className="mt-1.5 text-xs text-[var(--muted)]">
                        {provider.capabilities.includes("story") ? `故事模型：${provider.storyModel || "未提供"}` : provider.models.length ? `手动模型：${provider.models.join("、")}` : "尚未填写手动模型；可尝试读取接口模型。"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {provider.capabilities.includes("image") && <button
                        type="button"
                        disabled={!!providerBusy}
                        onClick={() => void discoverModels(provider)}
                        className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold hover:border-[var(--rose)] disabled:opacity-50"
                      >
                        <RefreshCw size={13} /> {providerBusy === provider.id ? "读取中…" : "读取模型"}
                      </button>}
                      {provider.capabilities.includes("story") && provider.kind === "novelai" && <button type="button" disabled={!!providerBusy} onClick={() => void readStoryAccount(provider)} className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold hover:border-[var(--rose)] disabled:opacity-50"><RefreshCw size={13} />读取账号</button>}
                      {provider.capabilities.includes("story") && <button type="button" disabled={!!providerBusy} onClick={() => editStoryProvider(provider)} className="h-9 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold hover:border-[var(--rose)] disabled:opacity-50">编辑</button>}
                      <button
                        type="button"
                        disabled={!!providerBusy}
                        onClick={() => void removeProvider(provider)}
                        className="grid h-9 w-9 place-items-center rounded border border-[var(--line)] bg-[var(--surface)] text-[var(--rose)] hover:border-[var(--rose)] disabled:opacity-50"
                        aria-label={`删除 ${provider.name}`}
                        title="删除接口"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {storyAccounts[provider.id] && (
                    <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--line)] pt-3 text-xs">
                      <div><dt className="text-[var(--muted)]">订阅等级</dt><dd>{tierNames[storyAccounts[provider.id].tier ?? -1] || "未知"} · {storyAccounts[provider.id].active === false ? "已停用" : "有效"}</dd></div>
                      <div><dt className="text-[var(--muted)]">Anlas</dt><dd>{storyAccounts[provider.id].anlas?.toLocaleString("zh-CN") ?? "未提供"}</dd></div>
                      <div><dt className="text-[var(--muted)]">有效至</dt><dd>{formatExpiry(storyAccounts[provider.id].expiresAt ?? null)}</dd></div>
                      <div><dt className="text-[var(--muted)]">优先级 / 上下文</dt><dd>{storyAccounts[provider.id].priority ?? "--"} / {storyAccounts[provider.id].contextTokens ?? "--"}</dd></div>
                    </dl>
                  )}
                  {discovered && (
                    <div className="mt-3 border-t border-[var(--line)] pt-3">
                      <p className="text-xs font-semibold">可选模型（{discovered.length}）</p>
                      {discovered.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {discovered.map((model) => (
                            <span key={model.id} className="rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 font-mono text-[10px]" title={model.kind}>
                              {model.id}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-[var(--muted)]">接口没有返回可用模型。</p>
                      )}
                      {discoveryWarning[provider.id] && <Notice message={discoveryWarning[provider.id]} error />}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p className="rounded-md border border-dashed border-[var(--line)] px-4 py-5 text-center text-xs text-[var(--muted)]">
              尚未导入自己的第三方图像 API。
            </p>
          )}
          <Notice message={providersError} error />
          <Notice message={providersMessage} />
        </div>

        <form onSubmit={(event) => void addProvider(event)} className="mt-5 grid gap-5 border-t border-[var(--line)] pt-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Plus size={15} className="text-[var(--rose)]" /> {editingStoryId ? "编辑故事来源" : "添加模型来源"}</h3>
            <label className="block text-xs font-semibold">模型能力<div className="mt-1.5"><PopupSelect value={capability} onChange={(value) => { setCapability(value as CapabilityChoice); if (value !== "story") setEditingStoryId(""); }} ariaLabel="模型能力" options={[{ value: "image", label: "图像", description: "生图与图像模型" }, { value: "story", label: "故事", description: "故事文本生成" }, { value: "both", label: "图像 + 故事", description: "统一来源同时提供两类模型" }]} /></div></label>
            <label className="block text-xs font-semibold">名称<input required maxLength={80} className="field mt-1.5 h-10 w-full px-3 text-sm" value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder={capability === "story" ? "例如：我的文本模型" : "例如：我的图像接口"} /></label>
            {capability === "story" ? <>
              <label className="block text-xs font-semibold">来源<select value={storyKind} onChange={(event) => { const value = event.target.value as "openai" | "novelai"; setStoryKind(value); setStoryModel(value === "novelai" ? "llama-3-erato-v1" : ""); }} className="field mt-1.5 h-10 w-full px-3 text-sm"><option value="openai">OpenAI 兼容 API</option><option value="novelai">NovelAI 官方持久 Key</option></select></label>
              {storyKind === "openai" && <label className="block text-xs font-semibold">API 地址<input required type="url" className="field mt-1.5 h-10 w-full px-3 text-sm" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" autoComplete="url" spellCheck={false} /></label>}
              <label className="block text-xs font-semibold">模型 ID{storyKind === "novelai" ? <select value={storyModel} onChange={(event) => setStoryModel(event.target.value)} className="field mt-1.5 h-10 w-full px-3 text-sm"><option value="llama-3-erato-v1">Erato</option><option value="kayra-v1">Kayra</option></select> : <input required maxLength={120} value={storyModel} onChange={(event) => setStoryModel(event.target.value)} placeholder="上游真实模型 ID" className="field mt-1.5 h-10 w-full px-3 text-sm" />}</label>
            </> : <>
              <label className="block text-xs font-semibold">API 地址<input required type="url" className="field mt-1.5 h-10 w-full px-3 text-sm" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" autoComplete="url" spellCheck={false} /></label>
              <label className="block text-xs font-semibold">图像接口协议<div className="mt-1.5"><PopupSelect value={protocol} onChange={(value) => setProtocol(value as ImageProviderProtocol)} ariaLabel="图像接口协议" options={[{ value: "auto", label: "NAI 原生", description: "按模型自动适配" }, { value: "openai-images", label: "GPT Images", description: "OpenAI Images 接口" }, { value: "gemini", label: "Nano Banana", description: "Gemini 原生接口" }]} /></div></label>
            </>}
            <label className="block text-xs font-semibold">{capability === "story" ? "API Key" : "API key"}<input required={!editingStoryId} type="password" className="field mt-1.5 h-10 w-full px-3 text-sm" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={editingStoryId ? "留空则保留原密钥" : "输入密钥"} autoComplete="new-password" spellCheck={false} /></label>
          </div>
          <div className="min-w-0 space-y-3">
            {capability !== "story" ? <><h3 className="text-sm font-semibold">模型 ID</h3><textarea required className="field min-h-32 w-full px-3 py-2 font-mono text-xs" value={manualModels} onChange={(event) => setManualModels(event.target.value)} placeholder={"每行一个，例如：\ngpt-image-1.5\nnai-v5-full\nnano-banana-pro"} spellCheck={false} /><div className="flex flex-wrap gap-1.5">{manualList.map((id) => <span key={id} className="rounded border border-[var(--line)] bg-[var(--surface-muted)] px-2 py-1 font-mono text-[10px]">{id} · {manualTag(id)}</span>)}</div><p className="text-[11px] leading-5 text-[var(--muted)]">也可用逗号分隔。保存后会尝试从接口读取模型；手动填写的 ID 始终可选。</p></> : <p className="text-xs leading-5 text-[var(--muted)]">故事来源会显示在同一列表中，并可在这里编辑或读取 NovelAI 账号状态。</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2"><p className="flex items-start gap-1.5 text-[11px] leading-5 text-[var(--muted)]"><CircleHelp size={13} className="mt-0.5 shrink-0" /> key 保存在服务端，页面不会再次显示。</p><div className="flex gap-2">{editingStoryId && <button type="button" onClick={() => { setEditingStoryId(""); setCapability("image"); }} className="h-10 rounded border border-[var(--line)] px-3 text-xs font-semibold">取消</button>}<button type="submit" disabled={!!providerBusy} className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-xs font-semibold text-white hover:bg-[var(--rose-dark)] disabled:opacity-50"><Plus size={15} /> {providerBusy === "create" ? "保存中…" : editingStoryId ? "保存修改" : "保存接口"}</button></div></div>
          </div>
        </form>
      </article>

      <article className="panel rounded-md p-5 sm:p-6" id="novelai-account">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Heading
            icon={<KeyRound size={18} />}
            eyebrow="NOVELAI · 官方账号"
            title="导入 NovelAI key"
            detail="通过官方 key 使用自己的 NovelAI 订阅，并查看套餐和 Anlas；无需填写账号密码。"
          />
          <button type="button" onClick={() => void loadAccount()} disabled={accountLoading || accountBusy} className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--muted)] hover:border-[var(--rose)] disabled:opacity-50">
            <RefreshCw size={13} /> 刷新账号
          </button>
        </div>

        {accountLoading ? (
          <p className="mt-5 text-xs text-[var(--muted)]">正在读取 NovelAI 账号…</p>
        ) : account ? (
          <div className="mt-5 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {accountError ? <CircleHelp size={16} className="text-[var(--rose)]" /> : <CircleCheck size={16} className="text-[var(--mint)]" />}
                  {accountError ? "Key 已保存，账号信息暂不可读取" : "已连接 NovelAI 官方账号"}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">{account.tier === null ? "套餐未知" : tierNames[account.tier] || `Tier ${account.tier}`} · {account.active === null ? "订阅状态未知" : account.active ? "订阅有效" : "订阅未激活"}</p>
              </div>
              <button type="button" disabled={accountBusy} onClick={() => void removeNovelAi()} className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--rose)] hover:border-[var(--rose)] disabled:opacity-50">
                <Trash2 size={13} /> 移除 key
              </button>
            </div>
            <div className={`mt-4 grid gap-2 sm:grid-cols-2 ${account.usage ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
              <div className="rounded border border-[var(--line)] bg-[var(--surface)] p-3">
                <p className="text-[11px] text-[var(--muted)]">剩余 Anlas</p>
                <p className="mt-1 text-lg font-semibold text-[var(--mint)]">{account.anlas ? account.anlas.total.toLocaleString("zh-CN") : "未知"}</p>
                {account.anlas && <p className="mt-1 text-[10px] text-[var(--muted)]">订阅 {account.anlas.fixed.toLocaleString("zh-CN")} · 购买 {account.anlas.purchased.toLocaleString("zh-CN")}</p>}
              </div>
              <div className="rounded border border-[var(--line)] bg-[var(--surface)] p-3">
                <p className="text-[11px] text-[var(--muted)]">套餐</p>
                <p className="mt-1 text-sm font-semibold">{account.tier === null ? "未知" : tierNames[account.tier] || `Tier ${account.tier}`}</p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">{account.active === null ? "无法确认订阅状态" : account.active ? "当前有效" : "当前未激活"}</p>
              </div>
              <div className="rounded border border-[var(--line)] bg-[var(--surface)] p-3">
                <p className="text-[11px] text-[var(--muted)]">有效期</p>
                <p className="mt-1 text-xs font-semibold">{formatExpiry(account.expiresAt)}</p>
              </div>
              {account.usage && (
                <div className="rounded border border-[var(--line)] bg-[var(--surface)] p-3">
                  <p className="text-[11px] text-[var(--muted)]">电量剩余</p>
                  <p className="mt-1 text-sm font-semibold">{Number.isFinite(account.usage.percent) ? `${Math.round(account.usage.percent)}%` : "未知"}</p>
                  <p className="mt-1 text-[10px] text-[var(--muted)]">下次恢复 1%：{formatWait(account.usage.timeUntilNextPercent)}</p>
                </div>
              )}
            </div>
            <button type="button" className="mt-4 text-xs font-semibold text-[var(--rose)] hover:underline" onClick={() => {
              if (editingNovelAi) setNovelAiKey("");
              setEditingNovelAi((current) => !current);
            }} aria-expanded={editingNovelAi}>
              {editingNovelAi ? "收起更换 key" : "更换 key"}
            </button>
          </div>
        ) : novelAiKeySaved ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-4">
            <div><p className="text-sm font-semibold">NovelAI key 已保存，但目前无法验证</p><p className="mt-1 text-xs text-[var(--muted)]">请更换 key，或稍后刷新账号信息。</p></div>
            <button type="button" disabled={accountBusy} onClick={() => void removeNovelAi()} className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--rose)] hover:border-[var(--rose)] disabled:opacity-50"><Trash2 size={13} /> 移除 key</button>
          </div>
        ) : (
          <p className="mt-5 rounded-md border border-dashed border-[var(--line)] px-4 py-5 text-center text-xs text-[var(--muted)]">
            尚未导入 NovelAI key。导入后可在这里查看账号与订阅信息。
          </p>
        )}
        <div className="mt-3 space-y-2">
          <Notice message={accountError} error />
          <Notice message={accountMessage} />
        </div>

        {(!account || editingNovelAi) && (
          <form onSubmit={(event) => void saveNovelAi(event)} className="mt-5 border-t border-[var(--line)] pt-5">
            <label className="block text-xs font-semibold">
              NovelAI 官方 key
              <input required type="password" className="field mt-1.5 h-10 w-full px-3 text-sm" value={novelAiKey} onChange={(event) => setNovelAiKey(event.target.value)} placeholder="粘贴 NovelAI key" autoComplete="new-password" spellCheck={false} />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] leading-5 text-[var(--muted)]">保存前会读取官方订阅信息验证 key；已有 key 无法在页面中查看。</p>
              <button type="submit" disabled={accountBusy} className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-xs font-semibold text-white hover:bg-[var(--rose-dark)] disabled:opacity-50">
                <KeyRound size={14} /> {accountBusy ? "验证中…" : novelAiKeySaved ? "更换 key" : "验证并导入"}
              </button>
            </div>
          </form>
        )}
      </article>
    </div>
  );
}
