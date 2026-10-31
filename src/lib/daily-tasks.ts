import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { withDataFileLock } from "@/lib/data-file-lock";
import { galleryActivityState } from "@/lib/gallery";
import type { GalleryActivityState } from "@/lib/gallery-activity-types";
import {
  grantCreatorReward,
  listCreatorRewardCampaigns,
  type CreatorRewardCampaign,
} from "@/lib/creator-rewards";
import { dailyTaskGeneration } from "@/lib/daily-task-generation";

const DAY = 86_400_000;
export const dailyTaskDay = (now = Date.now()) =>
  new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
const dayStart = (day: string) => Date.parse(`${day}T00:00:00+08:00`);
const nextDay = (day: string) => dailyTaskDay(dayStart(day) + DAY);
const file = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "rewards",
    "daily-tasks.json",
  );
type Enrollment = {
  campaignId: string;
  userId: number;
  joinedAt: string;
  amount: number;
  granted?: boolean;
};
type Generation = {
  campaignId: string;
  userId: number;
  day: string;
  requests: string[];
  count: number;
  target: number;
  amount: number;
  granted?: boolean;
};
export type DailyRankingRow = {
  userId: number;
  itemId: string;
  title: string;
  authorName: string;
  likes: number;
  rank: number;
  amount: number;
};
type Settlement = {
  campaignId: string;
  day: string;
  rows: DailyRankingRow[];
  granted: number[];
  settled?: boolean;
};
type Store = {
  enrollments: Enrollment[];
  generations: Generation[];
  settlements: Settlement[];
  through: Record<string, string>;
};
export type DailyTaskStatus = {
  day: string;
  resetsAt: string;
  authenticated: boolean;
  active: boolean;
  enrolled: boolean;
  enrollmentGranted: boolean;
  enrollmentAmount: number;
  count: number;
  target: number;
  generationAmount: number;
  generationGranted: boolean;
  rankingRewards: number[];
  rank: number | null;
  likes: number;
  rankingAmount: number;
  yesterday: { rank: number; amount: number; granted: boolean } | null;
};
async function readStore(): Promise<Store> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as Store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { enrollments: [], generations: [], settlements: [], through: {} };
  }
}
async function save(store: Store) {
  await mkdir(path.dirname(file()), { recursive: true });
  const temporary = `${file()}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store));
  await rename(temporary, file());
}
const locked = <T>(task: () => Promise<T>) =>
  withDataFileLock("daily-tasks", task);
const active = (campaign: CreatorRewardCampaign, now: number) =>
  campaign.settlementMode === "daily" &&
  campaign.enabled &&
  !campaign.deletedAt &&
  now >= Date.parse(campaign.startsAt || campaign.createdAt || "9999-01-01") &&
  (!campaign.endsAt || now < Date.parse(campaign.endsAt));

async function grantEnrollment(entry: Enrollment) {
  await grantCreatorReward({
    kind: "daily",
    campaignId: entry.campaignId,
    userId: entry.userId,
    amount: entry.amount,
    referenceId: `daily-join:${entry.campaignId}:${entry.userId}`,
    description: "日常任务：初始 AFF",
  });
  entry.granted = true;
}
async function grantGeneration(entry: Generation) {
  await grantCreatorReward({
    kind: "daily",
    campaignId: entry.campaignId,
    userId: entry.userId,
    amount: entry.amount,
    referenceId: `daily-generation:${entry.campaignId}:${entry.day}:${entry.userId}`,
    description: `日常任务：${entry.day} 生成达标`,
  });
  entry.granted = true;
}

export async function enrollDailyTasks(
  campaignId: string,
  userId: number,
  now = Date.now(),
) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("请先登录");
  return locked(async () => {
    const campaign = (await listCreatorRewardCampaigns()).find(
      (c) => c.id === campaignId,
    );
    if (!campaign?.dailyTasks || !active(campaign, now))
      throw new Error("日常活动尚未开始或已停用");
    const store = await readStore();
    let enrollment = store.enrollments.find(
      (e) => e.campaignId === campaignId && e.userId === userId,
    );
    if (!enrollment) {
      enrollment = {
        campaignId,
        userId,
        joinedAt: new Date(now).toISOString(),
        amount: campaign.dailyTasks.enrollmentReward,
      };
      store.enrollments.push(enrollment);
      await save(store); // Freeze the promised amount before touching the wallet.
    }
    if (!enrollment.granted) {
      await grantEnrollment(enrollment);
      await save(store);
    }
  });
}

/** Called only with verified server results, never with client-reported progress. */
export async function recordDailyTaskGeneration(input: {
  userId: number;
  requestId: string;
  generatedSamples: number;
  at: number;
}) {
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId <= 0 ||
    !input.requestId ||
    !Number.isSafeInteger(input.generatedSamples) ||
    input.generatedSamples <= 0 ||
    !Number.isFinite(input.at)
  )
    return;
  await locked(async () => {
    const campaigns = (await listCreatorRewardCampaigns()).filter(
      (c) => c.dailyTasks && active(c, input.at),
    );
    const store = await readStore();
    await applyGeneration(store, campaigns, input);
  });
}
async function applyGeneration(
  store: Store,
  campaigns: CreatorRewardCampaign[],
  input: {
    userId: number;
    requestId: string;
    generatedSamples: number;
    at: number;
  },
) {
  for (const campaign of campaigns.filter((c) => active(c, input.at))) {
    const enrollment = store.enrollments.find(
      (e) => e.campaignId === campaign.id && e.userId === input.userId,
    );
    if (!enrollment || Date.parse(enrollment.joinedAt) > input.at) continue;
    const day = dailyTaskDay(input.at);
    let progress = store.generations.find(
      (g) =>
        g.campaignId === campaign.id &&
        g.userId === input.userId &&
        g.day === day,
    );
    if (!progress) {
      progress = {
        campaignId: campaign.id,
        userId: input.userId,
        day,
        requests: [],
        count: 0,
        target: campaign.dailyTasks!.generationTarget,
        amount: campaign.dailyTasks!.generationReward,
      };
      store.generations.push(progress);
    }
    if (
      !progress.requests.includes(input.requestId) &&
      progress.count < progress.target
    ) {
      progress.requests.push(input.requestId);
      progress.count = Math.min(
        progress.target,
        progress.count + input.generatedSamples,
      );
      await save(store);
    }
    if (progress.count >= progress.target && !progress.granted) {
      await grantGeneration(progress);
      await save(store);
    }
  }
}

/** One author takes one place, using their best work's valid likes received that day. */
export function buildDailyRanking(
  campaign: CreatorRewardCampaign,
  state: GalleryActivityState,
  enrollments: Enrollment[],
  day: string,
  now = Date.now(),
): DailyRankingRow[] {
  const from = Math.max(
    dayStart(day),
    Date.parse(campaign.startsAt || campaign.createdAt || "9999-01-01"),
  );
  const cutoff = Math.min(
    dayStart(day) + DAY,
    campaign.endsAt ? Date.parse(campaign.endsAt) : Infinity,
    now,
  );
  const latest = new Map<string, GalleryActivityState["revisions"][number]>();
  for (const revision of state.revisions)
    if (Date.parse(revision.at) < cutoff) latest.set(revision.id, revision);
  const joined = new Map(
    enrollments
      .filter(
        (e) => e.campaignId === campaign.id && Date.parse(e.joinedAt) < cutoff,
      )
      .map((e) => [e.userId, Date.parse(e.joinedAt)]),
  );
  const likes = new Map<string, Map<number, number>>();
  for (const event of state.interactions) {
    const at = Date.parse(event.at);
    if (at < from || at >= cutoff || event.kind === "import") continue;
    const item = latest.get(event.id);
    if (
      !item ||
      item.status !== "approved" ||
      item.version !== event.version ||
      item.ownerId === event.userId ||
      !joined.has(item.ownerId) ||
      at < joined.get(item.ownerId)!
    )
      continue;
    let voters = likes.get(event.id);
    if (!voters) {
      voters = new Map();
      likes.set(event.id, voters);
    }
    if (event.kind === "unlike") voters.delete(event.userId);
    else if (!voters.has(event.userId)) voters.set(event.userId, at);
  }
  const seen = new Set<number>();
  return [...likes]
    .map(([id, voters]) => ({ item: latest.get(id)!, likes: voters.size }))
    .filter((row) => row.likes > 0)
    .sort(
      (a, b) =>
        b.likes - a.likes ||
        a.item.submittedAt.localeCompare(b.item.submittedAt) ||
        a.item.id.localeCompare(b.item.id),
    )
    .filter(({ item }) => {
      if (seen.has(item.ownerId)) return false;
      seen.add(item.ownerId);
      return true;
    })
    .slice(0, campaign.dailyTasks?.rankingRewards.length || 0)
    .map(({ item, likes }, index) => ({
      userId: item.ownerId,
      itemId: item.id,
      title: item.title,
      authorName: item.authorName,
      likes,
      rank: index + 1,
      amount: campaign.dailyTasks!.rankingRewards[index],
    }));
}

export async function dailyTaskStatus(
  campaign: CreatorRewardCampaign,
  userId?: number,
  now = Date.now(),
): Promise<DailyTaskStatus> {
  const [store, state] = await Promise.all([
    readStore(),
    galleryActivityState(),
  ]);
  const day = dailyTaskDay(now);
  const enrollment = store.enrollments.find(
    (e) => e.campaignId === campaign.id && e.userId === userId,
  );
  const generation = store.generations.find(
    (g) => g.campaignId === campaign.id && g.userId === userId && g.day === day,
  );
  const row = buildDailyRanking(
    campaign,
    state,
    store.enrollments,
    day,
    now,
  ).find((r) => r.userId === userId);
  const yesterday = store.settlements.find(
    (s) => s.campaignId === campaign.id && s.day === dailyTaskDay(now - DAY),
  );
  const previous = yesterday?.rows.find((r) => r.userId === userId);
  return {
    day,
    resetsAt: new Date(dayStart(day) + DAY).toISOString(),
    authenticated: !!userId,
    active: active(campaign, now),
    enrolled: !!enrollment,
    enrollmentGranted: !!enrollment?.granted,
    enrollmentAmount:
      enrollment?.amount ?? campaign.dailyTasks!.enrollmentReward,
    count: generation?.count || 0,
    target: generation?.target ?? campaign.dailyTasks!.generationTarget,
    generationAmount:
      generation?.amount ?? campaign.dailyTasks!.generationReward,
    generationGranted: !!generation?.granted,
    rankingRewards: campaign.dailyTasks!.rankingRewards,
    rank: row?.rank ?? null,
    likes: row?.likes || 0,
    rankingAmount: row?.amount || 0,
    yesterday: previous
      ? {
          rank: previous.rank,
          amount: previous.amount,
          granted: yesterday!.granted.includes(previous.userId),
        }
      : null,
  };
}

/** Freeze finished days before granting; startup and periodic retries resume the same receipts. */
export async function settleDueDailyTasks(now = Date.now()) {
  // Recover progress if the immediate hook failed after the verified audit was saved.
  const audits = await import("@/lib/request-audit").then((module) =>
    module.listRequestAudits(5000),
  );
  return locked(async () => {
    const campaigns = (await listCreatorRewardCampaigns()).filter(
      (c) => c.settlementMode === "daily" && c.dailyTasks && c.enabled,
    );
    const store = await readStore();
    const ids = new Set(campaigns.map((c) => c.id));
    for (const audit of [...audits].reverse()) {
      const generation = dailyTaskGeneration(audit);
      if (generation && generation.at <= now)
        await applyGeneration(store, campaigns, generation);
    }
    for (const enrollment of store.enrollments)
      if (ids.has(enrollment.campaignId) && !enrollment.granted) {
        await grantEnrollment(enrollment);
        await save(store);
      }
    for (const generation of store.generations)
      if (
        ids.has(generation.campaignId) &&
        generation.count >= generation.target &&
        !generation.granted
      ) {
        await grantGeneration(generation);
        await save(store);
      }
    const state = await galleryActivityState();
    for (const campaign of campaigns) {
      const start = campaign.startsAt || campaign.createdAt!;
      const firstEnrollment = store.enrollments
        .filter((e) => e.campaignId === campaign.id)
        .reduce((at, e) => Math.min(at, Date.parse(e.joinedAt)), Infinity);
      if (!Number.isFinite(firstEnrollment)) continue;
      let day = store.through[campaign.id]
        ? nextDay(store.through[campaign.id])
        : dailyTaskDay(Math.max(Date.parse(start), firstEnrollment));
      const last = Math.min(
        dayStart(dailyTaskDay(now)),
        campaign.endsAt ? Date.parse(campaign.endsAt) : Infinity,
      );
      while (dayStart(day) < last && dayStart(day) + DAY <= now) {
        let settlement = store.settlements.find(
          (s) => s.campaignId === campaign.id && s.day === day,
        );
        if (!settlement) {
          settlement = {
            campaignId: campaign.id,
            day,
            rows: buildDailyRanking(
              campaign,
              state,
              store.enrollments,
              day,
              now,
            ),
            granted: [],
          };
          store.settlements.push(settlement);
          await save(store);
        }
        for (const row of settlement.rows) {
          if (settlement.granted.includes(row.userId)) continue;
          await grantCreatorReward({
            kind: "daily",
            campaignId: campaign.id,
            userId: row.userId,
            amount: row.amount,
            description: `日常任务：${day} Gallery 日榜第 ${row.rank} 名`,
            referenceId: `daily-rank:${campaign.id}:${day}:${row.userId}`,
          });
          settlement.granted.push(row.userId);
          await save(store);
        }
        settlement.settled = true;
        store.through[campaign.id] = day;
        await save(store);
        day = nextDay(day);
      }
    }
  });
}
