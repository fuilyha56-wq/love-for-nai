"use client";
import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { LfnSwitch } from "@/app/ui/lfn-switch";
import { AdminButton, AdminCard } from "./ui/admin-primitives";
import { DEFAULT_IMAGE_BASE_FEES } from "@/lib/image-pricing";
import {
  CNY_PER_AFF,
  DEFAULT_DAILY_IMAGE_POLICY,
  type DailyImageBillingState,
  type DailyImagePolicy,
  type DailyPriceTier,
} from "@/lib/daily-image-pricing";

export default function DailyBillingPanel() {
  const [data, setData] = useState<DailyImageBillingState | null>(null),
    [policy, setPolicy] = useState<DailyImagePolicy | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/billing/daily", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "读取计费失败");
        setData(result);
        setPolicy(result.policy);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, []);
  function updateTier(
    family: "v45" | "v5",
    index: number,
    patch: Partial<DailyPriceTier>,
  ) {
    setPolicy((value) =>
      value
        ? {
            ...value,
            [family]: value[family].map((tier, position) =>
              position === index ? { ...tier, ...patch } : tier,
            ),
          }
        : value,
    );
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/billing/daily", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "保存计费失败");
      setData(result);
      setPolicy(result.policy);
      setMessage("计费规则已保存，后续请求立即使用新规则。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存计费失败");
    } finally {
      setBusy(false);
    }
  }
  const dirty = data && JSON.stringify(policy) !== JSON.stringify(data.policy);
  const packageCny =
    data && policy
      ? (data.packageCny * data.policy.displayUsdPerCny) /
        policy.displayUsdPerCny
      : 0;
  const cnyPerAff = CNY_PER_AFF;
  return (
    <AdminCard
      className="max-sm:[&>.admin-card-header]:flex-col [&_.admin-card-actions]:shrink-0 [&_.admin-button]:whitespace-nowrap"
      title="基础费用与每日分段计费"
      description="个人 AFF 与图包使用相同计价。基础费按模型与档内条件选取；每日张数按用户合并同系列模型，Limit 计入对应普通模型，北京时间零点重置。固定模型单价优先。"
      actions={
        <>
          <AdminButton
            disabled={busy}
            onClick={() =>
              setPolicy(structuredClone(DEFAULT_DAILY_IMAGE_POLICY))
            }
          >
            载入约定规则
          </AdminButton>
          <AdminButton
            variant="primary"
            disabled={!policy || busy || !dirty}
            onClick={() => void save()}
          >
            <Save size={14} />
            保存计费
          </AdminButton>
        </>
      }
    >
      {message && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-[var(--surface-muted)] p-3 text-sm"
        >
          {message}
        </p>
      )}
      {policy && (
        <fieldset disabled={busy} className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <LfnSwitch
              checked={policy.enabled}
              disabled={busy}
              label="启用每日阶梯"
              onChange={(enabled) => setPolicy({ ...policy, enabled })}
            />
            <LfnSwitch
              checked={policy.strictApiBilling === false}
              disabled={busy}
              label="额度不足时转交 NewAPI 生成"
              onChange={(allowed) => setPolicy({ ...policy, strictApiBilling: !allowed })}
            />
            {dirty && (
              <span className="text-xs text-amber-700">有未保存修改</span>
            )}
          </div>
          <div className="space-y-4 rounded-lg border border-[var(--line)] p-4">
            <h3 className="text-sm font-semibold">生图基础费（AFF / 张）</h3>
            <div className="grid gap-4 lg:grid-cols-3">
              {([
                {
                  label: "V4.5",
                  fields: [
                    { key: "v45LimitBaseAff", label: "Limit 小图" },
                    { key: "v45BaseAff", label: "常规 / 档外" },
                  ],
                },
                {
                  label: "V5 High",
                  fields: [
                    { key: "v5LimitBaseAff", label: "Limit 小图" },
                    { key: "v5BaseAff", label: "常规 / 档外" },
                  ],
                },
                {
                  label: "V5 Medium",
                  fields: [
                    { key: "v5MediumLimitBaseAff", label: "Limit 小图" },
                    { key: "v5MediumBaseAff", label: "常规 / 档外" },
                  ],
                },
              ] as const).map((family) => (
                <div key={family.label} className="rounded-lg bg-[var(--surface-muted)] p-3">
                  <h4 className="mb-3 text-xs font-semibold">{family.label}</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {family.fields.map((field) => (
                      <label key={field.key} className="text-xs text-[var(--ink)]">
                        {field.label}
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.0001}
                          aria-label={`${family.label} ${field.label}基础费（AFF / 张）`}
                          value={policy[field.key] ?? DEFAULT_IMAGE_BASE_FEES[field.key]}
                          className="field billing-base-fee-input mt-1.5 w-full"
                          onChange={(event) =>
                            setPolicy({
                              ...policy,
                              [field.key]: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs leading-6 text-[var(--muted)]">
              基础费可设为 0。Limit 小图价适用单张、≤28 步、≤1024² 像素且无付费参考等档内条件；普通 Full、Curated 和重绘模型满足条件时同样适用。工作台逐张生成分别判定，一次请求多张按档外规则计费。独立工具和 NewAPI 使用各自计费规则。
            </p>
          </div>
          <div className="space-y-3 rounded-lg border border-[var(--line)] p-4">
            <h3 className="text-sm font-semibold">V4.5 Limit 小图每日基础费</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                { key: "afterImages", label: "每日首档张数", step: 1 },
                { key: "baseAff", label: "首档基础费（AFF / 张）", step: 0.0001 },
                { key: "afterBaseAff", label: "超出后基础费（AFF / 张）", step: 0.0001 },
              ] as const).map(({ key, label, step }) => (
                <label key={key} className="text-xs text-[var(--muted)]">
                  {label}
                  <input
                    type="number"
                    min={0}
                    max={key === "afterImages" ? undefined : 100}
                    step={step}
                    value={policy.v45LimitDaily[key]}
                    className="field mt-1.5 w-full p-2"
                    onChange={(event) => setPolicy({
                      ...policy,
                      v45LimitDaily: { ...policy.v45LimitDaily, [key]: Number(event.target.value) },
                    })}
                  />
                </label>
              ))}
            </div>
            <p className="text-xs leading-6 text-[var(--muted)]">
              开启每日阶梯时，V4.5 Limit 小图按本节收费，张数使用账号当天的 V4.5 系列累计。
            </p>
          </div>
          <div className="grid gap-4 rounded-lg bg-[var(--surface-muted)] p-4 sm:grid-cols-3">
            <label className="text-xs font-semibold">
              每 ¥1 对应 NewAPI 显示余额
              <input
                type="number"
                min={0.0001}
                step={0.0001}
                value={policy.displayUsdPerCny}
                className="field mt-1.5 w-full p-2.5"
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    displayUsdPerCny: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="text-xs font-semibold">
              V4.5 每 Anlas（人民币）
              <input
                type="number"
                min={0}
                step={0.001}
                value={policy.v45AnlasCny}
                className="field mt-1.5 w-full p-2.5"
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    v45AnlasCny: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="text-xs font-semibold">
              V5 每 Anlas（人民币）
              <input
                type="number"
                min={0}
                step={0.001}
                value={policy.v5AnlasCny}
                className="field mt-1.5 w-full p-2.5"
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    v5AnlasCny: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <p className="text-xs leading-6 text-[var(--muted)]">
            当前图包售价：{data?.affPerPackage} AFF ≈ ¥
            {packageCny.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}；计价面值固定为 1 AFF = ¥{cnyPerAff}，不随图包折扣变化。
            生图基础费使用上方对应模型与档位的配置。下方“附加价参考值”只计算相对首档的附加费，不是生图基础费；NewAPI 的独立价格不套用这里的 AFF 基础价。
            Anlas 单价以当前配置为准。官方消耗量按模型计算，销售倍率只应用一次。超范围每 Anlas 分别为 {Number((policy.v45AnlasCny / cnyPerAff).toFixed(4))}/{Number((policy.v5AnlasCny / cnyPerAff).toFixed(4))} AFF。
            日阶梯只影响 LFN AFF/图包。转交 NewAPI 后由 NewAPI 生成、记录请求并按其模型配置计费，不参与本站每日张数阶梯。
          </p>
          {(["v45", "v5"] as const).map((family) => (
            <div
              key={family}
              className="rounded-lg border border-[var(--line)] p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                  {family === "v45" ? "V4.5" : "V5"} 系列
                </h3>
                <AdminButton
                  disabled={policy[family].length >= 10}
                  onClick={() =>
                    setPolicy({
                      ...policy,
                      [family]: [
                        ...policy[family],
                        {
                          ...policy[family].at(-1)!,
                          afterImages: policy[family].at(-1)!.afterImages + 100,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  添加阶梯
                </AdminButton>
              </div>
              <div className="space-y-3">
                {policy[family].map((tier, index) => (
                  <div
                    key={index}
                    className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                  >
                    {(
                      [
                        { key: "afterImages", label: "超过每日张数", step: 1 },
                        {
                          key: "baseCny",
                          label: "附加价参考值（¥）",
                          step: 0.001,
                        },
                        {
                          key: "anlasMultiplier",
                          label: "Anlas 倍率",
                          step: 0.01,
                        },
                        {
                          key: "totalMultiplier",
                          label: "整体倍率",
                          step: 0.005,
                        },
                      ] as const
                    ).map((field) => (
                      <label
                        key={field.key}
                        className="text-xs text-[var(--muted)]"
                      >
                        {field.label}
                        <input
                          type="number"
                          min={0}
                          step={field.step}
                          disabled={field.key === "afterImages" && index === 0}
                          aria-label={`${family === "v45" ? "V4.5" : "V5"} 第 ${index + 1} 档 ${field.label}`}
                          value={tier[field.key]}
                          className="field mt-1.5 w-full p-2"
                          onChange={(event) =>
                            updateTier(family, index, {
                              [field.key]: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                    <AdminButton
                      variant="icon"
                      disabled={index === 0}
                      aria-label={`删除 ${family} 第 ${index + 1} 档`}
                      onClick={() =>
                        setPolicy({
                          ...policy,
                          [family]: policy[family].filter(
                            (_, position) => position !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </AdminButton>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs leading-6 text-[var(--muted)]">
            每张 AFF =（基础 AFF +（本档参考值减首档参考值，最低为 0 + 本张 Anlas × 人民币单价 × Anlas 倍率）÷ {cnyPerAff}）×
            整体倍率。批次跨档时逐张计算，失败张数退回原扣费来源并释放每日计数。编码、放大和
            Director 工具继续使用各自计费公式。
          </p>
        </fieldset>
      )}
    </AdminCard>
  );
}
