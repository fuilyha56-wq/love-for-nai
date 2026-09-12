"use client";

import { CircleCheck, CircleX, Power, PowerOff, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PopupSelect } from "@/app/ui/popup-select";

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
  trainingStepsLeft?: { fixedTrainingStepsLeft?: number; purchasedTrainingSteps?: number };
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

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: "使用中", className: "text-[var(--mint)]" },
  ready: { label: "就绪", className: "text-[var(--mint)]" },
  cooldown: { label: "冷却中", className: "text-amber-600" },
  disabled: { label: "已停用", className: "text-[var(--muted)]" },
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

// 平台概览内嵌的 Gateway 区块：渠道池状态/启停/NAI 原始数据 + 模型计费覆盖。
export default function GatewaySection({ setMessage }: { setMessage: (msg: string) => void }) {
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

  async function accountAction(
    account: GatewayAccount,
    action: string,
    patch?: Record<string, unknown>,
  ) {
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
      setNaiData((current) => ({
        ...current,
        [account.id]: response.ok ? result : { message: result.message || "读取失败" },
      }));
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
  if (!overview) return null;

  const configuredModels = Object.keys(billing);
  const availableModels = overview.models
    .map((item) => item.id)
    .filter((id) => !configuredModels.includes(id));

  return (
    <div className="space-y-3">
      {/* ── 渠道池 ── */}
      <article className="rounded-lg border border-[var(--line)] bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">
              Gateway 渠道池（{overview.accounts.length}）
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              出图轮询的共享 NovelAI 账号。启停立即生效；「NAI 数据」拉取该账号的原始订阅与剩余额度。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="flex h-9 items-center gap-1.5 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--muted)] hover:border-[var(--rose)]"
          >
            <RefreshCw size={13} /> 刷新
          </button>
        </div>

        <div className="space-y-2">
          {overview.accounts.map((account) => {
            const status = STATUS_LABELS[account.status] || {
              label: account.status,
              className: "text-[var(--muted)]",
            };
            const detail = naiData[account.id];
            const sub = typeof detail === "object" ? detail.subscription : undefined;
            return (
              <div
                key={account.id}
                className="rounded-lg border border-[var(--line)] bg-[#faf9f5] px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {account.name}
                      <span className="rounded bg-[#f1eee7] px-1.5 py-0.5 font-mono text-[10px] text-[var(--muted)]">
                        {account.id}
                      </span>
                      <span className={`text-[10px] font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                      <span className="text-[10px] text-[var(--muted)]">
                        权重 {account.weight} · {account.masked_key}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
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
                        void accountAction(account, "account-update", {
                          enabled: !account.enabled,
                        })
                      }
                      className="grid h-10 w-10 place-items-center rounded border border-[var(--line)] bg-white hover:border-[var(--rose)] disabled:opacity-50"
                      title={account.enabled ? "停用渠道" : "启用渠道"}
                    >
                      {account.enabled ? <PowerOff size={15} /> : <Power size={15} />}
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
                      className="h-10 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--muted)] hover:border-[var(--rose)] disabled:opacity-50"
                    >
                      测试
                    </button>
                    <button
                      type="button"
                      disabled={busyAccount === account.id + "account-reset"}
                      onClick={() => void accountAction(account, "account-reset")}
                      className="h-10 rounded border border-[var(--line)] bg-white px-3 text-xs font-semibold text-[var(--muted)] hover:border-[var(--rose)] disabled:opacity-50"
                      title="清除失败与冷却状态"
                    >
                      重置
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadNaiData(account)}
                      className="flex h-10 items-center rounded bg-[var(--rose)] px-3 text-xs font-semibold text-white"
                    >
                      {detail === "loading" ? "拉取中…" : "NAI 数据"}
                    </button>
                  </div>
                </div>

                {detail && typeof detail === "object" && (
                  <div className="mt-3 rounded border border-[var(--line)] bg-white p-3 text-xs leading-6">
                    {"message" in detail && detail.message ? (
                      <span className="text-red-600">{detail.message}</span>
                    ) : sub ? (
                      <>
                        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-semibold">
                          <span className="flex items-center gap-1">
                            {sub.active ? (
                              <CircleCheck size={13} className="text-[var(--mint)]" />
                            ) : (
                              <CircleX size={13} className="text-red-600" />
                            )}
                            {TIER_LABELS[Number(sub.tier)] || `Tier ${sub.tier ?? "?"}`}
                            {sub.active ? " · 订阅有效" : " · 订阅未激活"}
                          </span>
                          <span>
                            剩余额度：
                            <b className="text-[var(--mint)]">{formatAnlas(sub.trainingStepsLeft)}</b>
                          </span>
                        </p>
                        <details className="mt-1.5">
                          <summary className="cursor-pointer select-none text-[11px] text-[var(--muted)]">
                            原始 NAI 返回
                          </summary>
                          <pre className="mt-2 max-h-64 overflow-auto rounded bg-[#f5f3ed] p-2 font-mono text-[10px] leading-5 text-[var(--muted)]">
{JSON.stringify(detail, null, 2)}
                          </pre>
                        </details>
                      </>
                    ) : (
                      <span className="text-[var(--muted)]">暂无数据</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!overview.accounts.length && (
            <p className="rounded-lg border border-dashed border-[var(--line)] px-4 py-6 text-center text-xs text-[var(--muted)]">
              Gateway 未配置任何渠道账号
            </p>
          )}
        </div>
      </article>

      {/* ── 模型计费配置 ── */}
      <article className="rounded-lg border border-[var(--line)] bg-white p-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-[var(--rose)]">
          模型价格计费配置
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          「自动公式」按内置规则计费（面积 × 步数、Opus 档内减免、超分按面积 1–4）；「固定」改为每张固定
          AFF，填 0 即该模型免费。保存后扣费与工作台的预计消耗立即生效。
        </p>

        <div className="mt-4 space-y-2">
          {configuredModels.map((model) => {
            const entry = billing[model];
            return (
              <div
                key={model}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--line)] bg-[#faf9f5] px-3 py-2.5"
              >
                <b className="min-w-40 font-mono text-xs">{model}</b>
                <PopupSelect
                  value={entry.mode}
                  onChange={(value) =>
                    updateBillingEntry(model, {
                      mode: value as ModelBillingEntry["mode"],
                      fixedCost: entry.fixedCost,
                    })
                  }
                  ariaLabel={`${model} 计费模式`}
                  options={[
                    { value: "auto", label: "自动公式" },
                    { value: "fixed", label: "固定 AFF/张" },
                  ]}
                />
                {entry.mode === "fixed" && (
                  <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
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
                      className="field h-9 w-24 px-2 text-xs"
                    />
                    AFF
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => updateBillingEntry(model, null)}
                  className="ml-auto grid h-9 w-9 place-items-center rounded border border-red-200 bg-white text-red-600 hover:border-red-400"
                  title="移除该模型的特殊计费"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
          {!configuredModels.length && (
            <p className="rounded-lg border border-dashed border-[var(--line)] px-4 py-5 text-center text-xs text-[var(--muted)]">
              所有模型都按自动公式计费
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--line)] px-3 py-2.5">
            <div className="w-64">
              <PopupSelect
                value={newModel}
                onChange={(value) => setNewModel(value)}
                ariaLabel="选择模型"
                options={[
                  { value: "", label: "选择要覆盖计费的模型…" },
                  ...availableModels.map((id) => ({ value: id, label: id })),
                ]}
              />
            </div>
            <button
              type="button"
              disabled={!newModel}
              onClick={() => {
                if (!newModel) return;
                updateBillingEntry(newModel, { mode: "auto", fixedCost: 0 });
                setNewModel("");
              }}
              className="h-10 rounded border border-[var(--rose)] bg-white px-3 text-xs font-semibold text-[var(--rose)] disabled:opacity-40"
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
            className="flex h-10 items-center gap-2 rounded bg-[var(--rose)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            <Save size={15} />
            {savingBilling ? "保存中…" : "保存计费配置"}
          </button>
        </div>
      </article>
    </div>
  );
}
