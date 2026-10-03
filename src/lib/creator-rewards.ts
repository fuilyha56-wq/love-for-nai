import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { grantAffOnce } from "@/lib/aff";
import {
  galleryWeekKey,
  listGalleryAdmin,
  markGalleryRewards,
  type GalleryItem,
} from "@/lib/gallery";

export type CreatorRewardKind = "submission" | "weekly" | "manual";
export type CreatorRewardStatus = "granted" | "skipped" | "failed";

export type CreatorRewardGrant = {
  id: string;
  kind: CreatorRewardKind;
  userId: number;
  amount: number;
  description: string;
  referenceId: string;
  status: CreatorRewardStatus;
  createdAt: string;
  actorId?: number;
  error?: string;
};

export type CreatorRewardCampaign = {
  id: string;
  name: string;
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
  submissionReward: number;
  weeklyRewards: [number, number, number];
  budget?: number;
};

type CreatorRewardStore = {
  campaigns: CreatorRewardCampaign[];
  grants: CreatorRewardGrant[];
};

const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "rewards");
const storePath = () => path.join(root(), "creator-rewards.json");
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

async function readStore(): Promise<CreatorRewardStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8")) as Partial<CreatorRewardStore>;
    return {
      campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
      grants: Array.isArray(parsed.grants) ? parsed.grants : [],
    };
  } catch {
    return { campaigns: [], grants: [] };
  }
}

async function writeStore(store: CreatorRewardStore): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = storePath();
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, target);
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function defaultCampaign(): CreatorRewardCampaign {
  return {
    id: "default",
    name: "创作者奖励",
    enabled: true,
    submissionReward: nonNegativeInteger(Number(process.env.LFN_CREATOR_SUBMISSION_REWARD), 100),
    weeklyRewards: [500, 300, 100],
  };
}

function activeCampaign(campaigns: CreatorRewardCampaign[], now = Date.now()): CreatorRewardCampaign {
  const matching = campaigns.find((campaign) => {
    if (!campaign.enabled) return false;
    const start = campaign.startsAt ? Date.parse(campaign.startsAt) : Number.NEGATIVE_INFINITY;
    const end = campaign.endsAt ? Date.parse(campaign.endsAt) : Number.POSITIVE_INFINITY;
    return now >= start && now <= end;
  });
  if (matching) return matching;
  if (!campaigns.length) return defaultCampaign();
  return { ...defaultCampaign(), id: "disabled", name: "奖励活动未启用", enabled: false, submissionReward: 0, weeklyRewards: [0, 0, 0] };
}

function assertUserId(userId: number): void {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("用户 id 不合法");
}

function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("奖励金额必须是非负整数");
}

/** Read the persisted campaign and grant records for admin views and audits. */
export async function creatorRewardStore(): Promise<CreatorRewardStore> {
  return withLock(readStore);
}

export async function listCreatorRewardGrants(): Promise<CreatorRewardGrant[]> {
  return (await creatorRewardStore()).grants;
}

export async function listCreatorRewardCampaigns(): Promise<CreatorRewardCampaign[]> {
  const store = await creatorRewardStore();
  return store.campaigns.length ? store.campaigns : [defaultCampaign()];
}

export async function upsertCreatorRewardCampaign(input: Partial<CreatorRewardCampaign> & { id?: string }): Promise<CreatorRewardCampaign> {
  return withLock(async () => {
    const store = await readStore();
    const id = String(input.id || "default").trim().slice(0, 80) || "default";
    const existing = store.campaigns.find((item) => item.id === id);
    const base = existing || defaultCampaign();
    const weekly = Array.isArray(input.weeklyRewards) && input.weeklyRewards.length >= 3
      ? input.weeklyRewards.slice(0, 3).map((value) => nonNegativeInteger(value, 0)) as [number, number, number]
      : base.weeklyRewards;
    const next: CreatorRewardCampaign = {
      ...base,
      ...input,
      id,
      name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 120) : base.name,
      enabled: input.enabled === undefined ? base.enabled : Boolean(input.enabled),
      submissionReward: nonNegativeInteger(input.submissionReward, base.submissionReward),
      weeklyRewards: weekly,
      ...(input.budget === undefined ? {} : { budget: nonNegativeInteger(input.budget, 0) }),
    };
    if (existing) Object.assign(existing, next);
    else store.campaigns.push(next);
    await writeStore(store);
    return next;
  });
}

/**
 * Grant an activity reward exactly once. The JSON record and AFF reference use
 * the same reference id, so retries are harmless even after a process restart.
 */
export async function grantCreatorReward(input: {
  kind: CreatorRewardKind;
  userId: number;
  amount: number;
  description: string;
  referenceId: string;
  actorId?: number;
}): Promise<CreatorRewardGrant> {
  assertUserId(input.userId);
  assertAmount(input.amount);
  const referenceId = input.referenceId.trim().slice(0, 180);
  if (!referenceId) throw new Error("奖励 referenceId 不能为空");
  return withLock(async () => {
    const store = await readStore();
    const previous = store.grants.find((item) => item.referenceId === referenceId && item.status !== "failed");
    if (previous) return previous;
    const record: CreatorRewardGrant = {
      id: randomUUID(),
      kind: input.kind,
      userId: input.userId,
      amount: input.amount,
      description: input.description.trim().slice(0, 160) || "创作者奖励",
      referenceId,
      status: "failed",
      createdAt: new Date().toISOString(),
      ...(input.actorId ? { actorId: input.actorId } : {}),
    };
    try {
      const result = await grantAffOnce(input.userId, input.amount, record.description, referenceId);
      record.status = result.granted ? "granted" : "skipped";
      store.grants.unshift(record);
      await writeStore(store);
      return record;
    } catch (error) {
      record.error = error instanceof Error ? error.message : "奖励发放失败";
      store.grants.unshift(record);
      await writeStore(store);
      throw error;
    }
  });
}

export async function grantSubmissionReward(userId: number, submissionId: string, actorId?: number): Promise<CreatorRewardGrant> {
  const campaign = activeCampaign(await listCreatorRewardCampaigns());
  return grantCreatorReward({
    kind: "submission",
    userId,
    amount: campaign.submissionReward,
    description: `${campaign.name}：投稿奖励`,
    referenceId: `creator-submission:${campaign.id}:${submissionId}`,
    actorId,
  });
}

export async function settleWeeklyCreatorRewards(week = galleryWeekKey(new Date(Date.now() - 7 * 24 * 3600_000))): Promise<{
  week: string;
  items: CreatorRewardGrant[];
}> {
  const campaign = activeCampaign(await listCreatorRewardCampaigns());
  const gallery = await listGalleryAdmin();
  const winners = gallery.filter((item) => item.status === "approved")
    .sort((a, b) => (b.weeklyLikes?.[week] || 0) - (a.weeklyLikes?.[week] || 0))
    .slice(0, 3)
    .filter((item) => Boolean(item.weeklyLikes?.[week]));
  const items: CreatorRewardGrant[] = [];
  for (const [index, item] of winners.entries()) {
    items.push(await grantCreatorReward({
      kind: "weekly",
      userId: item.ownerId,
      amount: campaign.weeklyRewards[index] || 0,
      description: `${campaign.name}：图库周榜第 ${index + 1} 名`,
      referenceId: `gallery-week:${week}:${item.id}`,
    }));
  }
  await markGalleryRewards(week, winners.map((item) => item.id));
  return { week, items };
}

export async function manuallyGrantCreatorReward(input: {
  userId: number;
  amount: number;
  description?: string;
  referenceId?: string;
  actorId?: number;
}): Promise<CreatorRewardGrant> {
  const referenceId = input.referenceId?.trim() || `creator-manual:${input.userId}:${randomUUID()}`;
  return grantCreatorReward({
    kind: "manual",
    userId: input.userId,
    amount: input.amount,
    description: input.description || "管理员手工发放创作者奖励",
    referenceId,
    actorId: input.actorId,
  });
}

export function creatorRewardWinner(item: GalleryItem, week: string): { userId: number; likes: number; referenceId: string } {
  return { userId: item.ownerId, likes: item.weeklyLikes?.[week] || 0, referenceId: `gallery-week:${week}:${item.id}` };
}
