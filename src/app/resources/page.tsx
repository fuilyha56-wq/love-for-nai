"use client";

import {
  ArrowLeft,
  Code2,
  Copy,
  ImageIcon,
  KeyRound,
  Link as LinkIcon,
  Plus,
  Power,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PopupSelect } from "@/app/ui/popup-select";
import {
  readJson,
  SessionExpiredError,
  SessionExpiredNotice,
} from "@/app/session-notice";

type ModelItem = { id: string; kind: string };
type TokenItem = {
  id: number;
  name: string;
  status: number;
  created_time?: number;
  accessed_time?: number;
  expired_time?: number;
  remain_quota?: number;
  used_quota?: number;
  unlimited_quota?: boolean;
  group?: string;
  model_limits_enabled?: boolean;
  model_limits?: string;
  allow_ips?: string;
};
type GroupItem = { name: string; desc: string; ratio: number };

const EXPIRE_PRESETS = [
  { label: "永不过期", value: "0" },
  { label: "1 天", value: "1" },
  { label: "7 天", value: "7" },
  { label: "30 天", value: "30" },
  { label: "90 天", value: "90" },
  { label: "365 天", value: "365" },
];

function formatStamp(seconds?: number): string {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString("zh-CN");
}

function formatDollars(value?: number | null): string {
  return `$${(Number(value ?? 0) / 500000).toFixed(2)}`;
}

// new-api 约定：-1 表示永不过期。
function formatExpiry(expiredTime?: number): string {
  if (expiredTime == null || expiredTime < 0) return "永不过期";
  const left = expiredTime * 1000 - Date.now();
  if (left <= 0) return "已过期";
  const days = Math.ceil(left / 86400_000);
  return days > 1 ? `${days} 天后过期` : "今天过期";
}

// navigator.clipboard 仅在 HTTPS 或 localhost 下存在，需要逐级降级。
async function writeClipboard(text: string): Promise<boolean> {  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒时继续尝试兜底方案。
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}

export default function ResourcesPage() {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [unlimited, setUnlimited] = useState(true);
  const [remainDollars, setRemainDollars] = useState("10");
  const [expireDays, setExpireDays] = useState("0");
  const [modelLimits, setModelLimits] = useState("");
  const [allowIps, setAllowIps] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState("");
  const [working, setWorking] = useState(false);
  const [modelLoadState, setModelLoadState] = useState<
    "loading" | "loaded" | "error"
  >("loading");
  const [modelLoadError, setModelLoadError] = useState("");
  const [tokenLoadState, setTokenLoadState] = useState<
    "loading" | "loaded" | "error"
  >("loading");
  const [tokenLoadError, setTokenLoadError] = useState("");
  const [revealed, setRevealed] = useState<{ id: number; key: string } | null>(
    null,
  );

  const loadModels = useCallback(async () => {
    setModelLoadState("loading");
    setModelLoadError("");
    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      const result = await readJson<{ items?: ModelItem[] }>(
        response,
        "读取模型失败",
      );
      setModels(result.items || []);
      setModelLoadState("loaded");
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      const nextError = error instanceof Error ? error.message : "读取模型失败";
      setModelLoadError(nextError);
      setModelLoadState("error");
    }
  }, []);
  const loadTokens = useCallback(async () => {
    setTokenLoadState("loading");
    setTokenLoadError("");
    try {
      const response = await fetch("/api/keys", { cache: "no-store" });
      const result = await readJson<{ items?: TokenItem[]; groups?: GroupItem[] }>(
        response,
        "读取密钥失败",
      );
      setTokens(result.items || []);
      const list = result.groups || [];
      setGroups(list);
      if (list.length && !list.some((item) => item.name === "default"))
        setGroup(list[0].name);
      else setGroup("default");
      setTokenLoadState("loaded");
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      const nextError = error instanceof Error ? error.message : "读取密钥失败";
      setTokenLoadError(nextError);
      setTokenLoadState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => {
      loadModels();
      loadTokens();
    });
  }, [loadModels, loadTokens]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          group,
          unlimitedQuota: unlimited,
          remainDollars: unlimited ? 0 : Number(remainDollars),
          expireDays: Number(expireDays) || 0,
          modelLimits,
          allowIps,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "创建失败");
      setName("");
      setModelLimits("");
      setAllowIps("");
      setFormOpen(false);
      await loadTokens();
      setMessage("API 密钥已创建。可点击复制按钮获取完整密钥。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setWorking(false);
    }
  }

  async function toggle(item: TokenItem) {
    setWorking(true);
    try {
      const response = await fetch("/api/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          status: item.status === 1 ? 2 : 1,
          statusOnly: true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "更新失败");
      await loadTokens();
      setMessage(item.status === 1 ? "密钥已停用。" : "密钥已启用。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新失败");
    } finally {
      setWorking(false);
    }
  }

  async function copyKey(item: TokenItem) {
    setWorking(true);
    try {
      const response = await fetch(`/api/keys/${item.id}/key`, { method: "POST" });
      const result = await readJson<{ key: string }>(response, "复制失败");
      if (await writeClipboard(result.key)) {
        setRevealed(null);
        setMessage(`已复制密钥“${item.name}”到剪贴板。`);
      } else {
        setRevealed({ id: item.id, key: result.key });
        setMessage("浏览器未授予剪贴板权限，请手动复制下方密钥。");
      }
    } catch (error) {
      if (error instanceof SessionExpiredError) setExpired(error.message);
      else setMessage(error instanceof Error ? error.message : "复制失败");
    } finally {
      setWorking(false);
    }
  }

  async function bindKey(item: TokenItem) {
    setWorking(true);
    try {
      const response = await fetch("/api/external-api/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId: item.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "绑定失败");
      setMessage(`密钥“${item.name}”已绑定 LFN 图包计费。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "绑定失败");
    } finally {
      setWorking(false);
    }
  }

  async function remove(item: TokenItem) {
    if (!window.confirm(`确认删除密钥“${item.name}”？`)) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/keys?id=${item.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "删除失败");
      await loadTokens();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setWorking(false);
    }
  }

  const imageModels = models.filter((item) => item.kind === "图像模型");
  const assistantModels = models.filter((item) => item.kind !== "图像模型");

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--line)] bg-[#fffefa]/95 px-4 backdrop-blur sm:px-7">
        <div className="flex items-center gap-3">
          <Sparkles size={20} className="text-[var(--rose)]" />
          <b>模型与密钥</b>
        </div>
        <Link href="/image" className="flex items-center gap-2 text-sm font-semibold">
          <ArrowLeft size={16} /> 返回工作台
        </Link>
      </header>
      <section className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
        {expired && <SessionExpiredNotice message={expired} />}
        {message && (
          <div className="rounded-md border border-[#e4c991] bg-[#fff8e8] p-3 text-sm text-[#77531e]">
            {message}
          </div>
        )}

        {/* 模型总览 */}
        <article className="panel rounded-md p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">
              MODELS · 可用模型
            </p>
            <p className="text-xs text-[var(--muted)]">
              图像 {imageModels.length} · 助手 {assistantModels.length}
            </p>
          </div>
          {!models.length && modelLoadState === "loading" && (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              正在读取当前分组可用模型…
            </p>
          )}
          {!models.length && modelLoadState === "error" && (
            <div className="my-4 rounded border border-[#e4c991] bg-[#fff8e8] p-4 text-center text-sm text-[#77531e]">
              <p>{modelLoadError || "读取模型失败"}</p>
              <button
                type="button"
                onClick={() => void loadModels()}
                className="mt-3 h-8 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white"
              >
                重试
              </button>
            </div>
          )}
          {!models.length && modelLoadState === "loaded" && (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              当前分组暂无可用模型。
            </p>
          )}
          {models.length > 0 && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {models.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2.5 rounded-md border border-[var(--line)] bg-white px-3 py-2.5"
                >
                  {item.kind === "图像模型" ? (
                    <ImageIcon size={16} className="shrink-0 text-[var(--rose)]" />
                  ) : (
                    <Sparkles size={16} className="shrink-0 text-emerald-700" />
                  )}
                  <div className="min-w-0">
                    <b className="block truncate text-xs">{item.id}</b>
                    <span className="text-[10px] text-[var(--muted)]">{item.kind}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        {/* API 密钥管理 */}
        <article className="panel rounded-md p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">
              API KEYS · 密钥管理
            </p>
            <button
              type="button"
              onClick={() => setFormOpen(!formOpen)}
              className="flex h-8 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold"
            >
              <Plus size={14} />
              {formOpen ? "收起表单" : "创建密钥"}
            </button>
          </div>
          {formOpen && (
            <form onSubmit={create} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">名称</span>
                  <input
                    className="field w-full px-3"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="输入新密钥名称"
                    aria-label="新密钥名称"
                  />
                </label>
                <div>
                  <span className="mb-1 block text-xs font-semibold">分组</span>
                  <PopupSelect
                    value={group}
                    ariaLabel="密钥分组"
                    searchable
                    searchPlaceholder="搜索分组"
                    emptyText="没有匹配的分组"
                    options={
                      groups.length
                        ? groups.map((item) => ({
                            value: item.name,
                            label: item.name,
                            description: `${item.desc || "无描述"}${item.ratio ? ` · ${item.ratio}x 倍率` : ""}`,
                          }))
                        : [{ value: "default", label: "default" }]
                    }
                    onChange={setGroup}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span className="mb-1 block text-xs font-semibold">有效期</span>
                  <PopupSelect
                    value={expireDays}
                    ariaLabel="有效期"
                    options={EXPIRE_PRESETS.map((preset) => ({
                      value: preset.value,
                      label: preset.label,
                    }))}
                    onChange={setExpireDays}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs font-semibold">额度</span>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={unlimited}
                      onChange={(event) => setUnlimited(event.target.checked)}
                      aria-label="无限额度"
                    />
                    无限额度
                  </label>
                  {!unlimited && (
                    <input
                      type="number"
                      min="0"
                      max="1000000000"
                      step="0.01"
                      className="field mt-2 w-full px-3"
                      value={remainDollars}
                      onChange={(event) => setRemainDollars(event.target.value)}
                      aria-label="剩余额度（美元）"
                      placeholder="剩余额度（美元）"
                    />
                  )}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">
                    模型限制 <small className="font-normal text-[var(--muted)]">（逗号分隔，留空不限制）</small>
                  </span>
                  <input
                    className="field w-full px-3 font-mono text-xs"
                    value={modelLimits}
                    onChange={(event) => setModelLimits(event.target.value)}
                    placeholder="nai-v5-full, nai-v4.5-full"
                    aria-label="模型限制"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">
                    IP 限制 <small className="font-normal text-[var(--muted)]">（逗号分隔，留空不限制）</small>
                  </span>
                  <input
                    className="field w-full px-3 font-mono text-xs"
                    value={allowIps}
                    onChange={(event) => setAllowIps(event.target.value)}
                    placeholder="1.2.3.4, 10.0.0.0/8"
                    aria-label="IP 限制"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="h-10 rounded border border-[var(--line)] bg-white px-4 text-sm font-semibold"
                >
                  取消
                </button>
                <button
                  disabled={working}
                  className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white hover:bg-[var(--rose-dark)] disabled:opacity-50"
                >
                  <Plus size={16} />
                  创建密钥
                </button>
              </div>
            </form>
          )}
          <p className="mt-2 text-xs text-[var(--muted)]">
            LFN 不保存或展示密钥明文。点击链条按钮绑定后，使用此密钥访问 LFN 图像端点会按图包 → 个人 AFF → NewAPI 余额扣费。
          </p>
          <div className="mt-4 space-y-2">
            {tokens.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-[var(--line)] bg-white p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <b className="flex items-center gap-1.5 text-sm">
                      <KeyRound size={13} className="text-[var(--muted)]" />
                      {item.name}
                    </b>
                    <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                      ID {item.id} · {item.status === 1 ? "已启用" : "已停用"}
                      {item.group ? ` · 分组 ${item.group}` : ""}
                      {item.unlimited_quota
                        ? " · 无限额度"
                        : ` · 剩余 ${formatDollars(item.remain_quota)}`}
                      {item.used_quota != null
                        ? ` · 已用 ${formatDollars(item.used_quota)}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                      创建 {formatStamp(item.created_time)}
                      {item.accessed_time
                        ? ` · 最近使用 ${formatStamp(item.accessed_time)}`
                        : ""}
                      {` · ${formatExpiry(item.expired_time)}`}
                      {item.model_limits_enabled && item.model_limits
                        ? ` · 限模型 ${item.model_limits.split(",").length} 个`
                        : ""}
                      {item.allow_ips ? ` · IP 限制` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => copyKey(item)}
                      disabled={working}
                      className="key-action"
                      title="复制密钥"
                      aria-label="复制密钥"
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => bindKey(item)}
                      disabled={working || item.status !== 1}
                      className="key-action"
                      title="绑定 LFN 图包计费"
                      aria-label="绑定 LFN 图包计费"
                    >
                      <LinkIcon size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(item)}
                      disabled={working}
                      className={`key-action ${item.status === 1 ? "" : "opacity-50"}`}
                      title={item.status === 1 ? "停用密钥" : "启用密钥"}
                      aria-label={item.status === 1 ? "停用密钥" : "启用密钥"}
                    >
                      <Power size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      disabled={working}
                      className="key-action text-[var(--rose)]"
                      title="删除密钥"
                      aria-label="删除密钥"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {revealed?.id === item.id && (
                  <input
                    className="field mt-2 w-full px-3 font-mono text-xs"
                    value={revealed.key}
                    readOnly
                    aria-label="密钥明文"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                )}
                {item.model_limits_enabled && item.model_limits && (
                  <p
                    className="mt-1.5 break-all font-mono text-[10px] text-[var(--muted)]"
                    title={item.model_limits}
                  >
                    {item.model_limits}
                  </p>
                )}
              </div>
            ))}
          </div>
          {!tokens.length && tokenLoadState === "loading" && (
            <p className="py-10 text-center text-sm text-[var(--muted)]">
              正在读取 API 密钥…
            </p>
          )}
          {!tokens.length && tokenLoadState === "error" && (
            <div className="my-5 rounded border border-[#e4c991] bg-[#fff8e8] p-4 text-center text-sm text-[#77531e]">
              <p>{tokenLoadError || "读取密钥失败"}</p>
              <button
                type="button"
                onClick={() => void loadTokens()}
                className="mt-3 h-8 rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white"
              >
                重试
              </button>
            </div>
          )}
          {!tokens.length && tokenLoadState === "loaded" && (
            <p className="py-10 text-center text-sm text-[var(--muted)]">
              暂无 API 密钥。创建一个密钥即可开始使用。
            </p>
          )}
        </article>

        <p className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <Code2 size={13} /> 密钥按 NewAPI 配额计费，消耗 500000 配额 = $1。
        </p>
      </section>
    </main>
  );
}
