import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  galleryActivityState,
  listGalleryAdmin,
  galleryWeekKey,
} from "@/lib/gallery";
import type {
  GalleryActivityRevision,
  GalleryActivityState,
} from "@/lib/gallery-activity-types";
import {
  campaignAllowsItem,
  deadlineCampaignForItem,
  grantCreatorReward,
  listCreatorRewardCampaigns,
  listCreatorRewardGrants,
  type CreatorRewardCampaign,
} from "@/lib/creator-rewards";
import { withDataFileLock } from "@/lib/data-file-lock";

export type ActivityRow = {
  id: string;
  title: string;
  originalFileName?: string;
  authorName: string;
  ownerName: string;
  ownerId: number;
  rating: string;
  promptMode?: string;
  noOriginalData?: boolean;
  upscaled?: boolean;
  likes: number;
  imports: number;
  score: number;
  submittedAt: string;
  rank: number;
  rewardRank?: number;
  reward: number;
};
export type ActivityBoard = {
  id: string;
  name: string;
  rewards: number[];
  consolationReward: number;
  rows: ActivityRow[];
};
export type ActivityAward = {
  userId: number;
  itemId: string;
  boardId: string;
  rank?: number;
  amount: number;
  referenceId: string;
  status: "pending" | "granted" | "failed";
  error?: string;
};
export type ActivitySettlement = {
  campaignId: string;
  cutoffAt: string;
  frozenAt: string;
  settledAt?: string;
  boards: ActivityBoard[];
  awards: ActivityAward[];
};
type Store = { settlements: ActivitySettlement[] };
const file = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "rewards",
    "activity-settlements.json",
  );

async function readSettlements(): Promise<Store> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as Store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { settlements: [] };
  }
}
async function saveSettlements(store: Store) {
  await mkdir(path.dirname(file()), { recursive: true });
  const temp = `${file()}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(store));
  await rename(temp, file());
}

function eligible(
  campaign: CreatorRewardCampaign,
  item: GalleryActivityRevision,
) {
  const submitted = Date.parse(item.submittedAt);
  return (
    item.status === "approved" &&
    submitted >= Date.parse(campaign.startsAt!) &&
    submitted < Date.parse(campaign.endsAt!) &&
    campaignAllowsItem(campaign, {
      tags: item.tags,
      rating: item.rating as "general",
      source: item.source as "local",
    })
  );
}
function boardFor(
  campaign: CreatorRewardCampaign,
  item: GalleryActivityRevision,
): string {
  if (
    item.originalProofStatus === "reviewed" &&
    campaign.boards?.some((b) => b.id === "verified")
  )
    return "verified";
  if (item.upscaled || item.noOriginalData || item.metadataState !== "readable")
    return "reduced";
  if (item.promptMode === "full") return "original";
  return item.promptMode === "partial"
    ? campaign.partialPromptBoard || "reduced"
    : "reduced";
}

/** Pure as-of calculation. Revisions and interactions share the gallery's atomic write. */
export function buildActivityBoards(
  campaign: CreatorRewardCampaign,
  state: GalleryActivityState,
  now = Date.now(),
): ActivityBoard[] {
  const cutoff = Math.min(now, Date.parse(campaign.endsAt!));
  const latest = new Map<string, GalleryActivityRevision>();
  const enteredAt = new Map<string, string>();
  for (const revision of state.revisions)
    if (Date.parse(revision.at) < cutoff) {
      latest.set(revision.id, revision);
      const key = `${revision.id}:${revision.version}`;
      if (!enteredAt.has(key)) enteredAt.set(key, revision.at);
    }
  const counters = new Map<
    string,
    { likes: Set<number>; imports: Set<number> }
  >();
  for (const event of state.interactions) {
    const item = latest.get(event.id);
    const at = Date.parse(event.at);
    if (
      !item ||
      item.version !== event.version ||
      event.userId === item.ownerId ||
      at < Date.parse(campaign.startsAt!) ||
      at < Date.parse(item.submittedAt) ||
      at >= cutoff
    )
      continue;
    const count = counters.get(item.id) || {
      likes: new Set<number>(),
      imports: new Set<number>(),
    };
    if (event.kind === "like") count.likes.add(event.userId);
    else if (event.kind === "unlike") count.likes.delete(event.userId);
    else count.imports.add(event.userId);
    counters.set(item.id, count);
  }
  return (campaign.boards || []).map((board) => {
    const rows: ActivityRow[] = [...latest.values()]
      .filter(
        (item) =>
          eligible(campaign, item) && boardFor(campaign, item) === board.id,
      )
      .map((item) => {
        const likes = counters.get(item.id)?.likes.size || 0,
          imports = counters.get(item.id)?.imports.size || 0;
        return {
          id: item.id,
          title: item.title,
          originalFileName: item.originalFileName,
          authorName: item.authorName,
          ownerName: item.ownerName,
          ownerId: item.ownerId,
          rating: item.rating,
          promptMode: item.promptMode,
          noOriginalData: item.noOriginalData,
          upscaled: item.upscaled,
          likes,
          imports,
          score: Number(
            (
              likes * campaign.scoring!.likes +
              imports * campaign.scoring!.imports
            ).toFixed(6),
          ),
          submittedAt:
            enteredAt.get(`${item.id}:${item.version}`) || item.submittedAt,
          rank: 0,
          reward: 0,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.likes - a.likes ||
          a.submittedAt.localeCompare(b.submittedAt) ||
          a.id.localeCompare(b.id),
      );
    const rewarded = new Set<number>();
    let rewardRank = 0;
    for (const [index, row] of rows.entries()) {
      row.rank = index + 1;
      if (campaign.oneWinnerPerUser !== false && rewarded.has(row.ownerId))
        continue;
      rewarded.add(row.ownerId);
      row.rewardRank = ++rewardRank;
      row.reward = board.rewards[rewardRank - 1] ?? board.consolationReward;
    }
    return { ...board, rows };
  });
}

export async function previewActivity(
  campaign: CreatorRewardCampaign,
  now = Date.now(),
) {
  const saved = (await readSettlements()).settlements.find(
    (s) => s.campaignId === campaign.id,
  );
  const boards =
    saved?.boards ||
    buildActivityBoards(campaign, await galleryActivityState(), now);
  return { campaign, boards, settlement: saved };
}

export async function settleActivity(
  campaignId: string,
  now = Date.now(),
): Promise<ActivitySettlement> {
  return withDataFileLock("activity-settlement", async () => {
    const campaign = (await listCreatorRewardCampaigns()).find(
      (c) => c.id === campaignId && c.settlementMode === "deadline",
    );
    if (!campaign || !campaign.enabled) throw new Error("活动不存在或未启用");
    if (now < Date.parse(campaign.settlesAt || campaign.endsAt!))
      throw new Error("尚未到活动发奖时间");
    const store = await readSettlements();
    let settlement = store.settlements.find((s) => s.campaignId === campaignId);
    if (
      settlement?.settledAt &&
      settlement.awards.every((a) => a.status === "granted")
    )
      return settlement;
    if (!settlement) {
      const boards = buildActivityBoards(
        campaign,
        await galleryActivityState(),
        now,
      );
      const awards = boards.flatMap((board) =>
        board.rows
          .filter((row) => row.rewardRank !== undefined)
          .map((row) => ({
            userId: row.ownerId,
            itemId: row.id,
            boardId: board.id,
            rank: row.rewardRank! <= 3 ? row.rewardRank : undefined,
            amount: row.reward,
            referenceId: `activity:${campaign.id}:${board.id}:${row.ownerId}:${row.rewardRank! <= 3 ? `rank-${row.rewardRank}` : "consolation"}`,
            status: "pending" as const,
          })),
      );
      settlement = {
        campaignId,
        cutoffAt: campaign.endsAt!,
        frozenAt: new Date(now).toISOString(),
        boards,
        awards,
      };
      store.settlements.push(settlement);
      await saveSettlements(store);
    }
    for (const award of settlement.awards) {
      if (award.status === "granted") continue;
      try {
        const record = await grantCreatorReward({
          kind: "activity",
          userId: award.userId,
          amount: award.amount,
          description: `${campaign.name} · ${campaign.boards!.find((b) => b.id === award.boardId)!.name} · ${award.rank ? `第 ${award.rank} 名` : "安慰奖"}`,
          referenceId: award.referenceId,
          campaignId,
        });
        if (record.status !== "granted")
          throw new Error(record.error || "奖励未到账");
        award.status = "granted";
        delete award.error;
      } catch (error) {
        award.status = "failed";
        award.error = error instanceof Error ? error.message : "发奖失败";
      }
      await saveSettlements(store);
    }
    if (settlement.awards.every((a) => a.status === "granted"))
      settlement.settledAt ||= new Date(now).toISOString();
    await saveSettlements(store);
    return settlement;
  });
}

export async function settleDueActivities(now = Date.now()) {
  const results: ActivitySettlement[] = [];
  const errors: unknown[] = [];
  for (const campaign of await listCreatorRewardCampaigns())
    if (
      campaign.enabled &&
      campaign.settlementMode === "deadline" &&
      Date.parse(campaign.settlesAt || campaign.endsAt!) <= now
    )
      try {
        results.push(await settleActivity(campaign.id, now));
      } catch (error) {
        errors.push(error);
      }
  if (errors.length)
    throw new AggregateError(errors, "部分活动结算失败，下次检查会重试");
  return results;
}

export async function publicActivityList(page = 1) {
  const campaigns = (await listCreatorRewardCampaigns())
    .filter((c) => c.settlementMode !== "daily" && (c.enabled || c.publishedAt) && c.publicVisible !== false)
    .sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) ||
        (b.priority || 0) - (a.priority || 0),
    );
  const settlements = (await readSettlements()).settlements;
  return {
    total: campaigns.length,
    page,
    pageCount: Math.max(1, Math.ceil(campaigns.length / 30)),
    items: campaigns.slice((page - 1) * 30, page * 30).map((c) => ({
      ...c,
      phase: settlements.find((s) => s.campaignId === c.id)?.settledAt
        ? "已结算"
        : !c.enabled
          ? "已暂停"
          : c.startsAt && Date.parse(c.startsAt) > Date.now()
            ? "未开始"
            : c.endsAt && Date.parse(c.endsAt) <= Date.now()
              ? c.settlementMode === "deadline"
                ? "待结算"
                : "已结束"
              : "进行中",
    })),
  };
}

export async function publicActivityDetail(id: string, page = 1) {
  const campaigns = await listCreatorRewardCampaigns();
  const campaign = campaigns.find(
    (c) =>
      c.id === id && c.settlementMode !== "daily" && (c.enabled || c.publishedAt) && c.publicVisible !== false,
  );
  if (!campaign) return null;
  if (campaign.settlementMode === "deadline") {
    const { boards, settlement } = await previewActivity(campaign);
    return {
      campaign,
      closed: Date.now() >= Date.parse(campaign.endsAt!),
      settledAt: settlement?.settledAt,
      frozenAt: settlement?.frozenAt,
      boards: boards.map((board) => ({
        ...board,
        total: board.rows.length,
        page,
        pageCount: Math.max(1, Math.ceil(board.rows.length / 50)),
        rows: board.rows.slice((page - 1) * 50, page * 50).map((row) => ({
          ...row,
          awardStatus: settlement?.awards.find((a) => a.itemId === row.id)
            ?.status,
        })),
      })),
    };
  }
  const week = galleryWeekKey();
  let items = (await listGalleryAdmin()).filter(
    (item) =>
      item.status === "approved" &&
      !deadlineCampaignForItem(campaigns, item) &&
      campaignAllowsItem(campaign, item),
  );
  const grants = (await listCreatorRewardGrants()).filter(
    (g) => g.campaignId === id && g.kind === "weekly" && g.status === "granted",
  );
  const metric = (item: (typeof items)[number]) =>
    campaign.weeklyMetric === "uses"
      ? item.weeklyUses?.[week] || 0
      : campaign.weeklyMetric === "downloads"
        ? item.weeklyDownloads?.[week] || 0
        : item.weeklyLikes?.[week] || 0;
  items.sort(
    (a, b) =>
      metric(b) - metric(a) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
  items = items.filter(
    (item) =>
      metric(item) > 0 &&
      metric(item) >=
        (campaign.minWeeklyMetric ?? campaign.minWeeklyLikes ?? 1),
  );
  if (campaign.oneWinnerPerUser)
    items = items.filter(
      (item, index, all) =>
        all.findIndex((candidate) => candidate.ownerId === item.ownerId) ===
        index,
    );
  return {
    campaign,
    legacy: true,
    weeklyGrants: grants.slice(0, 50).map((g) => ({
      description: g.description,
      amount: g.amount,
      createdAt: g.createdAt,
    })),
    boards: [
      {
        id: "weekly",
        name: "当前周榜",
        rewards: campaign.weeklyRewards,
        consolationReward: 0,
        total: items.length,
        page,
        pageCount: Math.max(1, Math.ceil(items.length / 50)),
        rows: items.slice((page - 1) * 50, page * 50).map((item, index) => ({
          id: item.id,
          title: item.title,
          originalFileName: item.originalFileName,
          authorName: item.authorName,
          ownerName: item.ownerName,
          rating: item.rating,
          likes: item.weeklyLikes?.[week] || 0,
          imports: item.weeklyUses?.[week] || 0,
          score: metric(item),
          rank: (page - 1) * 50 + index + 1,
          reward: campaign.weeklyRewards[(page - 1) * 50 + index] || 0,
        })),
      },
    ],
  };
}
