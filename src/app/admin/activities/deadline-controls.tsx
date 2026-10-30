"use client";
import { useState } from "react";
import Link from "next/link";
import type { CreatorRewardCampaign } from "@/lib/creator-rewards";
import type {
  ActivityBoard,
  ActivitySettlement,
} from "@/lib/activity-leaderboards";
import { defaultActivityBoards } from "@/lib/activity-config";

type Preview = { boards: ActivityBoard[]; settlement?: ActivitySettlement };
const localDate = (value?: string) =>
  value
    ? new Date(Date.parse(value) + 8 * 3600_000).toISOString().slice(0, 16)
    : "";
export function DeadlineControls({
  campaign,
  onChange,
}: {
  campaign: CreatorRewardCampaign;
  onChange: (patch: Partial<CreatorRewardCampaign>) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function inspect(settle = false) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/creator-rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: settle ? "settle-activity" : "preview-activity",
          id: campaign.id,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setPreview(
        settle ? { boards: result.boards, settlement: result } : result,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
      <h3 className="font-semibold">结算方式与活动多档榜单</h3>
      <label className="block text-sm">
        结算方式
        <select
          className="field ml-3 p-2"
          value={campaign.settlementMode || "weekly"}
          onChange={(e) =>
            onChange(
              e.target.value === "deadline"
                ? {
                    settlementMode: "deadline",
                    timezone: "Asia/Shanghai",
                    scoring: { likes: 1, imports: 1 },
                    boards: structuredClone(defaultActivityBoards),
                    partialPromptBoard: "reduced",
                    submissionReward: 0,
                    weeklyRewards: [0, 0, 0],
                    oneWinnerPerUser: true,
                    budget: 0,
                    settlesAt: campaign.endsAt,
                  }
                : { settlementMode: "weekly" },
            )
          }
        >
          <option value="weekly">原有周榜结算</option>
          <option value="deadline">指定日期结榜 · 多档榜单自动发奖</option>
        </select>
      </label>
      {campaign.settlementMode === "deadline" && (
        <>
          <p className="text-xs text-[var(--muted)]">
            开始后计分、资格、时间和奖励配置锁定。先保存，再预览线上实际配置。此活动不使用审核即发的投稿奖及自动周榜奖。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              点赞权重
              <input
                type="number"
                min="0"
                max="1000"
                step="0.1"
                className="field ml-2 w-24 p-2"
                value={campaign.scoring?.likes ?? 1}
                onChange={(e) =>
                  onChange({
                    scoring: {
                      likes: Number(e.target.value),
                      imports: campaign.scoring?.imports ?? 1,
                    },
                  })
                }
              />
            </label>
            <label className="text-sm">
              导入权重
              <input
                type="number"
                min="0"
                max="1000"
                step="0.1"
                className="field ml-2 w-24 p-2"
                value={campaign.scoring?.imports ?? 1}
                onChange={(e) =>
                  onChange({
                    scoring: {
                      likes: campaign.scoring?.likes ?? 1,
                      imports: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          </div>
          <label className="block text-sm">
            自动发奖时间（北京时间）
            <input
              type="datetime-local"
              className="field ml-2 p-2"
              value={localDate(campaign.settlesAt || campaign.endsAt)}
              onChange={(e) =>
                onChange({
                  settlesAt: e.target.value
                    ? new Date(`${e.target.value}:00+08:00`).toISOString()
                    : undefined,
                })
              }
            />
          </label>
          <label className="block text-sm">
            部分公开提示词归属
            <select
              className="field ml-2 p-2"
              value={campaign.partialPromptBoard || "reduced"}
              onChange={(e) =>
                onChange({
                  partialPromptBoard: e.target.value as "original" | "reduced",
                })
              }
            >
              <option value="reduced">非完整原数据榜</option>
              <option value="original">
                完整原数据榜（须明确修改活动规则）
              </option>
            </select>
          </label>
          {campaign.boards?.map((board, index) => (
            <fieldset
              key={board.id}
              className="space-y-2 rounded-lg border border-[var(--line)] p-3"
            >
              <legend>{board.name}</legend>
              <label className="block text-xs">
                榜单名称
                <input
                  className="field ml-2 p-2"
                  value={board.name}
                  onChange={(e) =>
                    onChange({
                      boards: campaign.boards!.map((b, i) =>
                        i === index ? { ...b, name: e.target.value } : b,
                      ),
                    })
                  }
                />
              </label>
              <div className="flex flex-wrap gap-3">
                {[...board.rewards, board.consolationReward].map(
                  (amount, rank) => (
                    <label key={rank} className="text-xs">
                      {rank < 3 ? `第 ${rank + 1} 名` : "安慰奖"}
                      <input
                        className="field ml-2 w-24 p-2"
                        type="number"
                        min="0"
                        step="1"
                        value={amount}
                        onChange={(e) =>
                          onChange({
                            boards: campaign.boards!.map((b, i) =>
                              i !== index
                                ? b
                                : rank === 3
                                  ? {
                                      ...b,
                                      consolationReward: Number(e.target.value),
                                    }
                                  : {
                                      ...b,
                                      rewards: b.rewards.map((v, r) =>
                                        r === rank ? Number(e.target.value) : v,
                                      ),
                                    },
                            ),
                          })
                        }
                      />{" "}
                      AFF
                    </label>
                  ),
                )}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="lfn-button"
              disabled={busy}
              onClick={() => void inspect()}
            >
              预览排名、支出与发放状态
            </button>
            <button
              type="button"
              className="lfn-button"
              disabled={busy}
              onClick={() => void inspect(true)}
            >
              到期结算 / 重试失败奖励
            </button>
            <Link
              className="lfn-button"
              href={`/gallery/activities?activity=${encodeURIComponent(campaign.id)}`}
            >
              公开榜单
            </Link>
          </div>
          {message && <p role="alert">{message}</p>}
          {preview && (
            <div className="space-y-2 text-xs">
              <p>
                预计总支出：
                {preview.boards.reduce(
                  (sum, b) => sum + b.rows.reduce((n, r) => n + r.reward, 0),
                  0,
                )}{" "}
                AFF ·{" "}
                {preview.settlement?.settledAt
                  ? "已结算"
                  : preview.settlement
                    ? "已冻结，仍有待处理奖励"
                    : "尚未冻结"}
              </p>
              {preview.boards.map((board) => (
                <div key={board.id}>
                  <strong>
                    {board.name}（{board.rows.length} 件）
                  </strong>
                  {board.rows.slice(0, 50).map((row) => (
                    <p key={row.id} className="break-words">
                      #{row.rank} {row.title} · ♥{row.likes} ↗{row.imports} ·{" "}
                      {row.score} 分 · {row.reward} AFF
                      {row.rewardRank
                        ? ` · 领奖顺位 ${row.rewardRank}`
                        : " · 不重复领奖"}
                    </p>
                  ))}
                </div>
              ))}
              {preview.settlement?.awards
                .filter((a) => a.status !== "granted")
                .map((a) => (
                  <p key={a.referenceId}>
                    {a.referenceId} · {a.status} · {a.error}
                  </p>
                ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
