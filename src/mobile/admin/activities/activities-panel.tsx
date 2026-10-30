"use client";
import Image from "next/image";
import { DeadlineControls } from "@/app/admin/activities/deadline-controls";

import { useCallback, useEffect, useState } from "react";
import { Copy, Plus, Save, Trash2, Undo2 } from "lucide-react";
import type { CreatorRewardCampaign } from "@/lib/creator-rewards";
import { clientUuid } from "@/lib/client-uuid";
import { LfnSelect } from "@/mobile/ui/lfn-select";
import { LfnSwitch } from "@/mobile/ui/lfn-switch";
import { LfnDateInput } from "@/mobile/ui/lfn-date-input";
import { lfnConfirm } from "@/mobile/ui/lfn-dialog";
import { MarkdownView } from "@/mobile/markdown";
import {
  AdminButton,
  AdminCard,
  AdminStatusBadge,
} from "../ui/admin-primitives";

const ratings = {
  general: "全年龄",
  r13: "R13",
  r17: "R17",
  r18: "R18",
} as const;
const dateValue = (value?: string) => (value ? new Date(Date.parse(value) + 8 * 3600_000).toISOString().slice(0, 16) : "");
const utcDate = (value: string) =>
  value &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}:00+08:00`))
    ? new Date(`${value}:00+08:00`).toISOString()
    : value;

export default function ActivitiesPanel() {
  const [campaigns, setCampaigns] = useState<CreatorRewardCampaign[]>([]);
  const [campaignSpent, setCampaignSpent] = useState<Record<string, number>>(
    {},
  );
  const [draft, setDraft] = useState<CreatorRewardCampaign | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/admin/creator-rewards?deleted=1", {
      cache: "no-store",
      signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "读取活动失败");
    setCampaigns(result.campaigns || []);
    setCampaignSpent(result.campaignSpent || {});
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => load(controller.signal))
      .catch((error) => {
        if (!controller.signal.aborted)
          setMessage(error instanceof Error ? error.message : "读取活动失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);
  function edit(patch: Partial<CreatorRewardCampaign>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }
  function create(source?: CreatorRewardCampaign) {
    setDraft({
      id: `activity-${clientUuid()}`,
      name: source ? `${source.name}（副本）` : "新活动",
      enabled: false,
      submissionReward: 100,
      weeklyRewards: [500, 300, 100],
      budget: 0,
      minWeeklyLikes: 1,
      minWeeklyMetric: 1,
      weeklyMetric: "likes",
      submissionLimitPerUser: 0,
      submissionRewardLimit: 0,
      priority: 1,
      allowedRatings: ["general", "r13", "r17", "r18"],
      allowedSources: ["other", "lfn", "local"],
      requiredTags: [],
      excludedTags: [],
      oneWinnerPerUser: false,
      publicVisible: true,
      featured: false,
      ...source,
      ...(source
        ? {
            id: `activity-${clientUuid()}`,
            name: `${source.name}（副本）`,
            enabled: false,
            deletedAt: undefined,
            createdAt: undefined,
          }
        : {}),
    });
    setPreview(false);
    setMessage("");
  }
  async function mutate(body: Record<string, unknown>, method = "POST") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/creator-rewards", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "活动操作失败");
      await load();
      if (result.campaign) setDraft(result.campaign);
      else setDraft(null);
      setMessage(
        method === "DELETE"
          ? "活动已删除，已发奖励记录仍保留，可从已删除活动恢复。"
          : body.action === "restore-campaign"
            ? "活动已恢复，请编辑并启用。"
            : "活动已保存。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "活动操作失败");
    } finally {
      setBusy(false);
    }
  }
  const visible = campaigns.filter(
    (item) => showDeleted === Boolean(item.deletedAt),
  );
  const spent = draft ? campaignSpent[draft.id] || 0 : 0;
  function numberField(
    label: string,
    key:
      | "budget"
      | "submissionReward"
      | "submissionLimitPerUser"
      | "submissionRewardLimit"
      | "minWeeklyLikes"
      | "minWeeklyMetric"
      | "priority",
  ) {
    return (
      <label className="block text-xs font-semibold">
        {label}
        <input
          type="number"
          min={0}
          step={1}
          className="field mt-1.5 w-full p-2.5"
          value={key === "minWeeklyMetric" ? draft?.minWeeklyMetric ?? draft?.minWeeklyLikes ?? 1 : draft?.[key] ?? 0}
          onChange={(event) => edit({ [key]: Number(event.target.value) })}
        />
      </label>
    );
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2.5fr)]">
      <AdminCard
        title="活动列表"
        actions={
          <AdminButton onClick={() => create()} disabled={busy}>
            <Plus size={14} />
            创建
          </AdminButton>
        }
      >
        <div className="mb-3 flex gap-2">
          <button
            className={`lfn-button ${!showDeleted ? "is-primary" : ""}`}
            onClick={() => setShowDeleted(false)}
          >
            活动 {campaigns.filter((item) => !item.deletedAt).length}
          </button>
          <button
            className={`lfn-button ${showDeleted ? "is-primary" : ""}`}
            onClick={() => setShowDeleted(true)}
          >
            已删除
          </button>
        </div>
        {loading ? (
          <p role="status">正在读取活动…</p>
        ) : visible.length ? (
          <ul className="space-y-2">
            {visible.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(structuredClone(item));
                    setPreview(false);
                    setMessage("");
                  }}
                  className={`w-full rounded-lg border p-3 text-left ${draft?.id === item.id ? "border-[var(--rose)] bg-[var(--surface-muted)]" : "border-[var(--line)]"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <b className="break-words text-sm">{item.name}</b>
                    <AdminStatusBadge
                      status={
                        item.deletedAt
                          ? "disabled"
                          : item.enabled
                            ? "published"
                            : "draft"
                      }
                      label={
                        item.deletedAt
                          ? "已删除"
                          : item.enabled
                            ? "已启用"
                            : "未启用"
                      }
                    />
                  </span>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                    {item.summary || "尚未填写活动简介"}
                  </p>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    {item.startsAt?.slice(0, 10) || "不限开始"} →{" "}
                    {item.endsAt?.slice(0, 10) || "不限结束"}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-8 text-center text-sm text-[var(--muted)]">
            暂无活动
          </p>
        )}
      </AdminCard>
      <div className="min-w-0 space-y-4">
        {message && (
          <p
            role="status"
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 text-sm"
          >
            {message}
          </p>
        )}
        {!draft ? (
          <AdminCard
            title="配置独立活动"
            description="创建活动或从左侧选择活动，配置内容、日期、资格、奖励与预算。"
          >
            <p className="py-12 text-center text-sm text-[var(--muted)]">
              每个活动使用独立 ID，发放记录可追溯。
            </p>
          </AdminCard>
        ) : (
          <>
            <AdminCard
              title={draft.name || "编辑活动"}
              description={`活动 ID：${draft.id}`}
              actions={
                <>
                  <AdminButton
                    disabled={busy || Boolean(draft.deletedAt)}
                    onClick={() => create(draft)}
                  >
                    <Copy size={14} />
                    复制
                  </AdminButton>
                  {draft.deletedAt ? (
                    <AdminButton
                      disabled={busy}
                      onClick={() =>
                        void mutate({
                          action: "restore-campaign",
                          id: draft.id,
                        })
                      }
                    >
                      <Undo2 size={14} />
                      恢复
                    </AdminButton>
                  ) : (
                    <>
                      <AdminButton
                        variant="danger"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await lfnConfirm(
                              `删除活动「${draft.name}」？活动将停止发奖，历史账本仍保留。`,
                            )
                          )
                            await mutate({ id: draft.id }, "DELETE");
                        }}
                      >
                        <Trash2 size={14} />
                        删除
                      </AdminButton>
                      <AdminButton
                        variant="primary"
                        disabled={busy}
                        onClick={() =>
                          void mutate({ action: "campaign", ...draft })
                        }
                      >
                        <Save size={14} />
                        {busy ? "保存中…" : "保存活动"}
                      </AdminButton>
                    </>
                  )}
                </>
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <LfnSwitch
                  checked={draft.enabled}
                  disabled={busy || Boolean(draft.deletedAt)}
                  label="启用活动"
                  onChange={(enabled) => edit({ enabled })}
                />
                <button
                  type="button"
                  className="lfn-button"
                  onClick={() => setPreview((value) => !value)}
                >
                  {preview ? "返回配置" : "预览活动"}
                </button>
              </div>
              <p className="mt-3 text-xs text-[var(--muted)]">
                已发放 {spent} AFF ·{" "}
                {draft.budget
                  ? `预算剩余 ${Math.max(0, draft.budget - spent)} AFF`
                  : "不限总预算"}
              </p>
            </AdminCard>
            <DeadlineControls key={draft.id} campaign={draft} onChange={edit} />
            {preview ? (
              <AdminCard title={draft.name} description={draft.summary}>
                {draft.coverUrl && (
                  <Image
                    unoptimized
                    width={960}
                    height={320}
                    src={draft.coverUrl}
                    alt={`${draft.name}封面`}
                    className="mb-4 max-h-64 w-full rounded-lg object-cover"
                  />
                )}
                <MarkdownView
                  content={draft.description || "尚未填写活动内容"}
                />
                <h3 className="mb-2 mt-5 font-semibold">参与规则</h3>
                <MarkdownView content={draft.rules || "尚未填写参与规则"} />
                <p className="mt-5 text-sm">
                  {draft.settlementMode === "deadline" ? "限时多档榜单，截止后统一发放，详见多档榜单配置。" : `投稿奖励 ${draft.submissionReward} AFF · 周榜奖励 ${draft.weeklyRewards.join(" / ")} AFF`}
                </p>
              </AdminCard>
            ) : (
              <fieldset
                disabled={busy || Boolean(draft.deletedAt)}
                className="min-w-0 space-y-4"
              >
                <AdminCard
                  title="活动信息"
                  description="活动简介、内容与规则会显示在公开活动页。"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-xs font-semibold">
                      活动名称
                      <input
                        className="field mt-1.5 w-full p-2.5"
                        maxLength={120}
                        value={draft.name}
                        onChange={(event) => edit({ name: event.target.value })}
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      封面图片 URL
                      <input
                        className="field mt-1.5 w-full p-2.5"
                        value={draft.coverUrl || ""}
                        placeholder="https://…"
                        onChange={(event) =>
                          edit({ coverUrl: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label className="mt-4 block text-xs font-semibold">
                    活动简介
                    <input
                      className="field mt-1.5 w-full p-2.5"
                      maxLength={300}
                      value={draft.summary || ""}
                      onChange={(event) =>
                        edit({ summary: event.target.value })
                      }
                    />
                  </label>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-xs font-semibold">
                      活动内容（Markdown）
                      <textarea
                        rows={8}
                        className="field mt-1.5 w-full p-3 font-normal"
                        value={draft.description || ""}
                        onChange={(event) =>
                          edit({ description: event.target.value })
                        }
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      参与规则（Markdown）
                      <textarea
                        rows={8}
                        className="field mt-1.5 w-full p-3 font-normal"
                        value={draft.rules || ""}
                        onChange={(event) =>
                          edit({ rules: event.target.value })
                        }
                      />
                    </label>
                  </div>
                </AdminCard>
                <AdminCard
                  title="时间与参与资格"
                  description="时间使用北京时间；限时活动按各自榜单结算，原有周榜保持原规则。"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-xs font-semibold">
                      开始时间（北京时间）
                      <LfnDateInput
                        type="datetime-local"
                        value={dateValue(draft.startsAt)}
                        onChange={(event) =>
                          edit({ startsAt: utcDate(event.target.value) })
                        }
                        className="mt-1.5"
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      结束时间（北京时间）
                      <LfnDateInput
                        type="datetime-local"
                        value={dateValue(draft.endsAt)}
                        onChange={(event) =>
                          edit({ endsAt: utcDate(event.target.value) })
                        }
                        className="mt-1.5"
                      />
                    </label>
                    {numberField("活动优先级", "priority")}
                    <label className="text-xs font-semibold">
                      必须包含的全部标签（逗号分隔）
                      <input
                        className="field mt-1.5 w-full p-2.5"
                        placeholder="留空不限制，例如：blue, portrait"
                        value={(draft.requiredTags?.length ? draft.requiredTags : draft.requiredTag ? [draft.requiredTag] : []).join(", ")}
                        onChange={(event) => {
                          const requiredTags = event.target.value.split(/[\n,，]/).map((tag) => tag.trim()).filter(Boolean);
                          edit({ requiredTags, requiredTag: requiredTags[0] || "" });
                        }}
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      排除标签（逗号分隔）
                      <input
                        className="field mt-1.5 w-full p-2.5"
                        placeholder="作品包含任一标签时不符合活动"
                        value={(draft.excludedTags || []).join(", ")}
                        onChange={(event) => edit({ excludedTags: event.target.value.split(/[\n,，]/).map((tag) => tag.trim()).filter(Boolean) })}
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-4">
                    {Object.entries(ratings).map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={(
                            draft.allowedRatings || Object.keys(ratings)
                          ).includes(key as keyof typeof ratings)}
                          onChange={(event) =>
                            edit({
                              allowedRatings: event.target.checked
                                ? [
                                    ...(draft.allowedRatings ||
                                      (Object.keys(
                                        ratings,
                                      ) as (keyof typeof ratings)[])),
                                    key as keyof typeof ratings,
                                  ]
                                : (
                                    draft.allowedRatings ||
                                    (Object.keys(
                                      ratings,
                                    ) as (keyof typeof ratings)[])
                                  ).filter((rating) => rating !== key),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="mt-4 border-t border-[var(--line)] pt-4">
                    <p className="mb-2 text-xs font-semibold">允许的投稿来源</p>
                    <div className="flex flex-wrap gap-4">
                      {([["local", "本地上传"], ["lfn", "本站生成"], ["other", "其他来源"]] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-xs">
                          <input type="checkbox" checked={(draft.allowedSources || ["other", "lfn", "local"]).includes(key)} onChange={(event) => edit({ allowedSources: event.target.checked ? [...(draft.allowedSources || ["other", "lfn", "local"]), key] : (draft.allowedSources || ["other", "lfn", "local"]).filter((source) => source !== key) })} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-4 border-t border-[var(--line)] pt-4">
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.oneWinnerPerUser === true} onChange={(event) => edit({ oneWinnerPerUser: event.target.checked })} />周榜每位用户最多一个名次</label>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.publicVisible !== false} onChange={(event) => edit({ publicVisible: event.target.checked })} />在创作者工作台公开展示</label>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.featured === true} onChange={(event) => edit({ featured: event.target.checked })} />置顶展示</label>
                  </div>
                </AdminCard>
                <AdminCard
                  title="奖励与预算"
                  description="0 预算或个人次数表示不限。投稿奖励仅在审核通过后发放，周榜自动结算上一完整 UTC 周。"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    {numberField("活动总预算（AFF）", "budget")}
                    {numberField("投稿奖励（AFF）", "submissionReward")}
                    {numberField(
                      "每人投稿奖励次数上限",
                      "submissionLimitPerUser",
                    )}
                    {numberField("活动投稿奖励总次数上限", "submissionRewardLimit")}
                    <label className="block text-xs font-semibold">
                      周榜统计指标
                      <LfnSelect aria-label="每周活动排名指标" className="field mt-1.5 w-full p-2.5" value={draft.weeklyMetric || "likes"} onChange={(event) => edit({ weeklyMetric: event.target.value as CreatorRewardCampaign["weeklyMetric"] })}>
                        <option value="likes">点赞数</option>
                        <option value="downloads">下载数</option>
                        <option value="uses">导入使用数</option>
                      </LfnSelect>
                    </label>
                    {numberField("周榜最低指标值", "minWeeklyMetric")}
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">周榜奖励名次</h3>
                    <AdminButton
                      disabled={draft.weeklyRewards.length >= 20}
                      onClick={() =>
                        edit({ weeklyRewards: [...draft.weeklyRewards, 0] })
                      }
                    >
                      <Plus size={14} />
                      添加名次
                    </AdminButton>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {draft.weeklyRewards.map((amount, index) => (
                      <label key={index} className="text-xs font-semibold">
                        第 {index + 1} 名（AFF）
                        <div className="mt-1.5 flex gap-1">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={amount}
                            className="field min-w-0 flex-1 p-2.5"
                            onChange={(event) =>
                              edit({
                                weeklyRewards: draft.weeklyRewards.map(
                                  (value, rank) =>
                                    rank === index
                                      ? Number(event.target.value)
                                      : value,
                                ),
                              })
                            }
                          />
                          <AdminButton
                            variant="icon"
                            disabled={draft.weeklyRewards.length <= 1}
                            aria-label={`删除第 ${index + 1} 名奖励`}
                            onClick={() =>
                              edit({
                                weeklyRewards: draft.weeklyRewards.filter(
                                  (_, rank) => rank !== index,
                                ),
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </AdminButton>
                        </div>
                      </label>
                    ))}
                  </div>
                </AdminCard>
              </fieldset>
            )}
          </>
        )}
      </div>
    </div>
  );
}
