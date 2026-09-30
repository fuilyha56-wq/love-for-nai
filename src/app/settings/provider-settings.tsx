"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleCheck,
  CircleHelp,
  KeyRound,
  Layers3,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  hasKey: boolean;
  createdAt: string;
};

type DiscoveredModel = { id: string; kind: string };

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

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    setProvidersError("");
    try {
      const result = await readJson<{ items: Provider[] }>(await fetch("/api/providers", { cache: "no-store" }));
      setProviders(Array.isArray(result.items) ? result.items : []);
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
    const controller = new AbortController();
    fetch("/api/providers", { cache: "no-store", signal: controller.signal })
      .then((response) => readJson<{ items: Provider[] }>(response))
      .then((result) => {
        if (!controller.signal.aborted) setProviders(Array.isArray(result.items) ? result.items : []);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setProvidersError(cause instanceof Error ? cause.message : "读取接口失败。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setProvidersLoading(false);
      });
    fetch("/api/providers/novelai", { cache: "no-store", signal: controller.signal })
      .then((response) => readJson<{ account: NovelAiAccount | null; keySaved?: boolean; error?: string }>(response))
      .then((result) => {
        if (controller.signal.aborted) return;
        setAccount(result.account || null);
        setNovelAiKeySaved(Boolean(result.keySaved || result.account));
        if (result.error) setAccountError(result.error);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setAccountError(cause instanceof Error ? cause.message : "读取 NovelAI 账号失败。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setAccountLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function addProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProvidersError("");
    setProvidersMessage("");
    setProviderBusy("create");
    try {
      const result = await readJson<{ item: Provider }>(await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: providerName.trim(),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          models: modelIds(manualModels),
        }),
      }));
      setProviders((current) => [...current, result.item]);
      setProviderName("");
      setBaseUrl("");
      setApiKey("");
      setManualModels("");
      setProvidersMessage(`已保存「${result.item.name}」。可在生图工作台的模型菜单中选择。`);
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
      await readJson<{ ok: true }>(await fetch(`/api/providers?id=${encodeURIComponent(provider.id)}`, { method: "DELETE" }));
      setProviders((current) => current.filter((item) => item.id !== provider.id));
      setProvidersMessage(`已删除「${provider.name}」。`);
    } catch (cause) {
      setProvidersError(cause instanceof Error ? cause.message : "删除接口失败。");
    } finally {
      setProviderBusy("");
    }
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
            title="接入自己的图像 API"
            detail="填写 OpenAI 兼容接口的地址和 key；模型 ID 可手动指定，也可保存后读取接口公布的模型。"
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
                <div key={provider.id} className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {provider.name}
                        <span className="inline-flex items-center gap-1 rounded bg-[color-mix(in_srgb,var(--mint)_10%,var(--surface))] px-2 py-0.5 text-[10px] font-semibold text-[var(--mint)]">
                          <CircleCheck size={11} /> 已保存 key
                        </span>
                      </p>
                      <p className="mt-1 break-all font-mono text-[11px] text-[var(--muted)]">{provider.baseUrl}</p>
                      <p className="mt-1.5 text-xs text-[var(--muted)]">
                        {provider.models.length ? `手动模型：${provider.models.join("、")}` : "尚未填写手动模型；可尝试读取接口模型。"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={!!providerBusy}
                        onClick={() => void discoverModels(provider)}
                        className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-xs font-semibold hover:border-[var(--rose)] disabled:opacity-50"
                      >
                        <RefreshCw size={13} /> {providerBusy === provider.id ? "读取中…" : "读取模型"}
                      </button>
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

        <form onSubmit={(event) => void addProvider(event)} className="mt-5 border-t border-[var(--line)] pt-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Plus size={15} className="text-[var(--rose)]" /> 添加第三方 API</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">
              名称
              <input required maxLength={80} className="field mt-1.5 h-10 w-full px-3 text-sm" value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="例如：我的图像接口" />
            </label>
            <label className="text-xs font-semibold">
              API 地址
              <input required type="url" className="field mt-1.5 h-10 w-full px-3 text-sm" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" autoComplete="url" spellCheck={false} />
            </label>
            <label className="text-xs font-semibold sm:col-span-2">
              API key
              <input required type="password" className="field mt-1.5 h-10 w-full px-3 text-sm" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="粘贴此接口的 key" autoComplete="new-password" spellCheck={false} />
            </label>
            <label className="text-xs font-semibold sm:col-span-2">
              自定义模型 ID（可选）
              <textarea className="field mt-1.5 min-h-20 w-full px-3 py-2 font-mono text-xs" value={manualModels} onChange={(event) => setManualModels(event.target.value)} placeholder={"每行一个，例如：\nmy-image-model"} spellCheck={false} />
              <span className="mt-1 block text-[11px] font-normal leading-5 text-[var(--muted)]">也可用逗号分隔。保存后会尝试从接口读取模型；手动填写的 ID 始终可选。</span>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-start gap-1.5 text-[11px] leading-5 text-[var(--muted)]">
              <CircleHelp size={13} className="mt-0.5 shrink-0" /> key 保存在服务端，页面不会再次显示；仅导入你有权使用的接口。
            </p>
            <button type="submit" disabled={!!providerBusy} className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-xs font-semibold text-white hover:bg-[var(--rose-dark)] disabled:opacity-50">
              <Plus size={15} /> {providerBusy === "create" ? "保存中…" : "保存接口"}
            </button>
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
