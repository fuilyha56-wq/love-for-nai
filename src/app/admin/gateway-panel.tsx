"use client";

import { CircleCheck, CircleX, Power, PowerOff, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// 面板固定使用 NovelAI 官网同款深蓝夜色与紫蓝主色，独立于站点主题。
const NAI = {
  paper: "#13152c",
  panel: "#191b31",
  line: "#22253f",
  ink: "#ffffff",
  muted: "#b3b4c8",
  accent: "#7052e6",
  accentSoft: "rgba(112, 82, 230, 0.16)",
  ok: "#4fd1a5",
  warn: "#e8b84b",
  bad: "#ef6a6a",
};

type GatewayAccount = {
  id: string;
  name: string;
  masked_key: string;
  weight: number;
  enabled: boolean;
  status: string;
  last_error: string | null;
  success_count: number;
  failure_count: number;
  last_used_at: number | null;
};

type GatewayModel = { id: string; name: string; type: string; enabled: boolean };

type ModelBillingEntry = { mode: "auto" | "fixed"; fixedCost: number };
type ModelBillingMap = Record<string, ModelBillingEntry>;

type GatewayOverview = {
  accounts: GatewayAccount[];
  models: GatewayModel[];
  usage: Record<string, unknown> | null;
  modelBilling: ModelBillingMap;
};

type NaiSubscription = {
  tier?: number;
  active?: boolean;
  status?: number;
  expiresAt?: number;
  trainingStepsLeft?: { fixedTrainingStepsLeft?: number; purchasedTrainingSteps?: number };
  perks?: { grossWeeklyTokens?: number } | Record<string, unknown>;
};

type NaiAccountData = {
  account_id?: string;
  masked_key?: string;
  subscription?: NaiSubscription;
  user_data?: Record<string, unknown>;
  message?: string;
};

const TIER_LABELS: Record<number, string> = {
  0: "Paper（免费）",
  1: "Tablet",
  2: "Scroll",
  3: "Opus",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: "使用中", color: NAI.ok },
  ready: { label: "就绪", color: NAI.ok },
  cooldown: { label: "冷却中", color: NAI.warn },
  disabled: { label: "已停用", color: NAI.muted },
};

function formatAnlas(steps: NaiSubscription["trainingStepsLeft"]): string {
  if (!steps || typeof steps !== "object") return "未知";
  const fixed = Number(steps.fixedTrainingStepsLeft);
  const purchased = Number(steps.purchasedTrainingSteps);
  const total =
    (Number.isFinite(fixed) ? fixed : 0) + (Number.isFinite(purchased) ? purchased : 0);
  return Number.isFinite(total) ? `${Math.floor(total)} Anlas` : "未知";
}

function formatTime(value: number | null | undefined): string {
  if (!value) return "从未使用";
  return new Date(value * 1000).toLocaleString("zh-CN", { hour12: false });
}

export default function GatewayPanel({ setMessage }: { setMessage: (msg: string) => void }) {
  const [overview, setOverview] = useState<GatewayOverview | null>(null);
  const [billing, setBilling] = useState<ModelBillingMap>({});
  const [loading, setLoading] = useState(true);
  const [busyAccount, setBusyAccount] = useState("");
  const [savingBilling, setSavingBilling] = useState(false);
  const [naiData, setNaiData] = useState<Record<string, NaiAccountData | "loading">>({});
  const [newModel, setNewModel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/gateway", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "Gateway 状态读取失败");
        return;
      }
      setOverview(result);
      setBilling(result.modelBilling || {});
    } catch {
      setMessage("Gateway 状态读取失败");
    } finally {
      setLoading(false);
    }
  }, [setMessage]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function accountAction(account: GatewayAccount, action: string, patch?: Record<string, unknown>) {
    setBusyAccount(account.id + action);
    try {
      const response = await fetch("/api/admin/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, accountId: account.id, ...patch }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || `${action} 失败`);
        return result;
      }
      if (action === "account-test") return result;
      setMessage(
        action === "account-update"
          ? `已${patch?.enabled ? "启用" : "停用"}渠道 ${account.name}`
          : "渠道状态已重置",
      );
      await load();
      return result;
    } catch {
      setMessage("请求失败");
      return null;
    } finally {
      setBusyAccount("");
    }
  }

  async function loadNaiData(account: GatewayAccount) {
    const expanded = naiData[account.id];
    if (expanded && expanded !== "loading") {
      setNaiData((current) => {
        const next = { ...current };
        delete next[account.id];
        return next;
      });
      return;
    }
    setNaiData((current) => ({ ...current, [account.id]: "loading" }));
    try {
      const response = await fetch(`/api/admin/gateway?nai=${encodeURIComponent(account.id)}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as NaiAccountData;
      setNaiData((current) => ({ ...current, [account.id]: response.ok ? result : { message: result.message || "读取失败" } }));
    } catch {
      setNaiData((current) => ({ ...current, [account.id]: { message: "读取失败" } }));
    }
  }

  function updateBillingEntry(model: string, entry: ModelBillingEntry | null) {
    setBilling((current) => {
      const next = { ...current };
      if (entry) next[model] = entry;
      else delete next[model];
      return next;
    });
  }

  async function saveBilling() {
    setSavingBilling(true);
    try {
      const response = await fetch("/api/admin/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-billing", modelBilling: billing }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.message || "计费配置保存失败");
        return;
      }
      setMessage("模型计费配置已保存，立即生效");
      setBilling(result.modelBilling || {});
    } catch {
      setMessage("计费配置保存失败");
    } finally {
      setSavingBilling(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--muted)]">加载中…</p>;
  if (!overview)
    return <p className="text-sm text-[var(--muted)]">Gateway 不可用</p>;

  const configuredModels = Object.keys(billing);
  const availableModels = overview.models
    .map((item) => item.id)
    .filter((id) => !configuredModels.includes(id));

  return (
    <div className="space-y-5 font-sans" style={{ color: NAI.ink }}>
      {/* ── 渠道（NAI 账号池） ── */}
      <section
        className="rounded-xl border p-5"
        style={{ background: NAI.panel, borderColor: NAI.line }}
      >
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p
              className="text-xs font-bold uppercase tracking-[0.14em]"
              style={{ color: NAI.accent }}
            >
              Channels
            </p>
            <h3 className="mt-1 text-base font-bold">NovelAI 渠道池（{overview.accounts.length}）</h3>
            <p className="mt-1 text-xs leading-5" style={{ color: NAI.muted }}>
              出图轮询的共享账号。启用/停用立即生效；「NAI 数据」拉取该账号在 NovelAI
              的原始订阅与剩余额度。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"
            style={{ borderColor: NAI.line, color: NAI.muted }}
          >
            <RefreshCw size={13} /> 刷新
          </button>
        </header>

        <div className="space-y-3">
          {overview.accounts.map((account) => {
            const status = STATUS_LABELS[account.status] || {
              label: account.status,
              color: NAI.muted,
            };
            const detail = naiData[account.id];
            const sub = typeof detail === "object" ? detail.subscription : undefined;
            return (
              <article
                key={account.id}
                className="rounded-lg border p-4"
                style={{ background: NAI.paper, borderColor: NAI.line }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      {account.name}
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                        style={{ background: NAI.accentSoft, color: NAI.muted }}
                      >
                        {account.id}
                      </span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: NAI.accentSoft, color: status.color }}
                      >
                        {status.label}
                      </span>
                      <span className="text-[10px] font-normal" style={{ color: NAI.muted }}>
                        权重 {account.weight} · {account.masked_key}
                      </span>
                    </p>
                    <p className="mt-1 text-[11px]" style={{ color: NAI.muted }}>
                      成功 {account.success_count} · 失败 {account.failure_count} · 最近使用{" "}
                      {formatTime(account.last_used_at)}
                      {account.last_error ? ` · 最近错误：${account.last_error.slice(0, 80)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyAccount === account.id + "account-update"}
                      onClick={() =>
                        void accountAction(account, "account-update", { enabled: !account.enabled })
                      }
                      className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold disabled:opacity-50"
                      style={{ borderColor: NAI.line }}
                      title={account.enabled ? "停用渠道" : "启用渠道"}
                    >
                      {account.enabled ? <PowerOff size={13} /> : <Power size={13} />}
                      {account.enabled ? "停用" : "启用"}
                    </button>
                    <button
                      type="button"
                      disabled={busyAccount === account.id + "account-test"}
                      onClick={async () => {
                        const result = await accountAction(account, "account-test");
                        if (result)
                          setMessage(
                            `${account.name} 测试：${result.ok ? "✅ " : "❌ "}${result.message}`,
                          );
                      }}
                      className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold disabled:opacity-50"
                      style={{ borderColor: NAI.line, color: NAI.muted }}
                    >
                      测试
                    </button>
                    <button
                      type="button"
                      disabled={busyAccount === account.id + "account-reset"}
                      onClick={() => void accountAction(account, "account-reset")}
                      className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold disabled:opacity-50"
                      style={{ borderColor: NAI.line, color: NAI.muted }}
                      title="清除失败与冷却状态"
                    >
                      重置
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadNaiData(account)}
                      className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-white disabled:opacity-50"
                      style={{ background: `linear-gradient(135deg, ${NAI.accent}, #4a57d6)` }}
                    >
                      {detail === "loading" ? "拉取中…" : "NAI 数据"}
                    </button>
                  </div>
                </div>

                {detail && typeof detail === "object" && (
                  <div
                    className="mt-3 rounded-lg border p-3 text-xs leading-6"
                    style={{ borderColor: NAI.line, background: NAI.panel }}
                  >
                    {"message" in detail && detail.message ? (
                      <span style={{ color: NAI.bad }}>{detail.message}</span>
                    ) : sub ? (
                      <>
                        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-semibold">
                          <span className="flex items-center gap-1">
                            {sub.active ? (
                              <CircleCheck size={13} style={{ color: NAI.ok }} />
                            ) : (
                              <CircleX size={13} style={{ color: NAI.bad }} />
                            )}
                            {TIER_LABELS[Number(sub.tier)] || `Tier ${sub.tier ?? "?"}`}
                            {sub.active ? " · 订阅有效" : " · 订阅未激活"}
                          </span>
                          <span>
                            剩余额度：<b style={{ color: NAI.ok }}>{formatAnlas(sub.trainingStepsLeft)}</b>
                          </span>
                          {typeof sub.status === "number" && (
                            <span style={{ color: NAI.muted }}>status={sub.status}</span>
                          )}
                        </p>
                        <details className="mt-2">
                          <summary
                            className="cursor-pointer select-none text-[11px]"
                            style={{ color: NAI.muted }}
                          >
                            原始 NAI 返回
                          </summary>
                          <pre
                            className="mt-2 max-h-64 overflow-auto rounded p-2 font-mono text-[10px] leading-5"
                            style={{ background: NAI.paper, color: NAI.muted }}
                          >
{JSON.stringify(detail, null, 2)}
                          </pre>
                        </details>
                      </>
                    ) : (
                      <span style={{ color: NAI.muted }}>暂无数据</span>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {!overview.accounts.length && (
            <p
              className="rounded-lg border border-dashed px-4 py-6 text-center text-xs"
              style={{ borderColor: NAI.line, color: NAI.muted }}
            >
              Gateway 未配置任何渠道账号
            </p>
          )}
        </div>
      </section>

      {/* ── 模型价格计费配置 ── */}
      <section
        className="rounded-xl border p-5"
        style={{ background: NAI.panel, borderColor: NAI.line }}
      >
        <header className="mb-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: NAI.accent }}>
            Model Pricing
          </p>
          <h3 className="mt-1 text-base font-bold">模型价格计费配置</h3>
          <p className="mt-1 text-xs leading-5" style={{ color: NAI.muted }}>
            「自动」使用内置公式（面积 × 步数、Opus 档内减免、超分按面积 1–4）；「固定」改为每张固定
            AFF，填 0 即该模型免费。保存后计费与工作台的预计消耗立即生效。
          </p>
        </header>

        <div className="space-y-2">
          {configuredModels.map((model) => {
            const entry = billing[model];
            return (
              <div
                key={model}
                className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5"
                style={{ background: NAI.paper, borderColor: NAI.line }}
              >
                <b className="min-w-40 font-mono text-xs">{model}</b>
                <select
                  value={entry.mode}
                  onChange={(event) =>
                    updateBillingEntry(model, {
                      mode: event.target.value as ModelBillingEntry["mode"],
                      fixedCost: entry.fixedCost,
                    })
                  }
                  className="h-8 rounded border bg-transparent px-2 text-xs"
                  style={{ borderColor: NAI.line, color: NAI.ink }}
                >
                  <option value="auto">自动公式</option>
                  <option value="fixed">固定 AFF/张</option>
                </select>
                {entry.mode === "fixed" && (
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: NAI.muted }}>
                    单价
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={entry.fixedCost}
                      onChange={(event) =>
                        updateBillingEntry(model, {
                          mode: entry.mode,
                          fixedCost: Math.max(0, Number(event.target.value) || 0),
                        })
                      }
                      className="h-8 w-24 rounded border bg-transparent px-2 text-xs"
                      style={{ borderColor: NAI.line, color: NAI.ink }}
                    />
                    AFF
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => updateBillingEntry(model, null)}
                  className="ml-auto grid h-8 w-8 place-items-center rounded-lg border"
                  style={{ borderColor: NAI.line, color: NAI.bad }}
                  title="移除该模型的特殊计费"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
          {!configuredModels.length && (
            <p
              className="rounded-lg border border-dashed px-4 py-5 text-center text-xs"
              style={{ borderColor: NAI.line, color: NAI.muted }}
            >
              所有模型都按自动公式计费
            </p>
          )}

          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2.5"
            style={{ borderColor: NAI.line }}
          >
            <select
              value={newModel}
              onChange={(event) => setNewModel(event.target.value)}
              className="h-8 rounded border bg-transparent px-2 text-xs"
              style={{ borderColor: NAI.line, color: NAI.ink }}
            >
              <option value="">选择要覆盖计费的模型…</option>
              {availableModels.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!newModel}
              onClick={() => {
                if (!newModel) return;
                updateBillingEntry(newModel, { mode: "auto", fixedCost: 0 });
                setNewModel("");
              }}
              className="flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold disabled:opacity-40"
              style={{ borderColor: NAI.accent, color: NAI.accent }}
            >
              添加
            </button>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={savingBilling}
            onClick={() => void saveBilling()}
            className="flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-bold text-white disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${NAI.accent}, #4a57d6)` }}
          >
            <Save size={13} />
            {savingBilling ? "保存中…" : "保存计费配置"}
          </button>
        </div>
      </section>
    </div>
  );
}
