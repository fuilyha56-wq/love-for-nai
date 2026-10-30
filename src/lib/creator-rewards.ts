import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { grantAffOnce } from "@/lib/aff";
import { createUserNotification } from "@/lib/notifications";
import {
  galleryWeekKey,
  listGalleryAdmin,
  markGalleryRewards,
  type GalleryItem,
} from "@/lib/gallery";
import { withDataFileLock } from "@/lib/data-file-lock";
import { canonicalGalleryTag } from "@/lib/gallery-tags";

export type CreatorRewardKind = "submission" | "weekly" | "manual" | "activity";
export type CreatorRewardStatus = "granted" | "skipped" | "failed";
export type CreatorWeeklyMetric = "likes" | "downloads" | "uses";

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
  campaignId?: string;
};

export type CreatorRewardCampaign = {
  settlementMode?: "weekly" | "deadline";
  timezone?: "Asia/Shanghai" | "UTC";
  settlesAt?: string;
  scoring?: { likes: number; imports: number };
  boards?: Array<{ id: "original" | "verified" | "reduced"; name: string; rewards: number[]; consolationReward: number }>;
  partialPromptBoard?: "original" | "reduced";
  id: string;
  name: string;
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
  submissionReward: number;
  weeklyRewards: number[];
  budget?: number;
  summary?: string;
  description?: string;
  rules?: string;
  coverUrl?: string;
  requiredTag?: string;
  requiredTags?: string[];
  excludedTags?: string[];
  allowedRatings?: Array<"general" | "r13" | "r17" | "r18">;
  allowedSources?: Array<"other" | "lfn" | "local">;
  minWeeklyLikes?: number;
  weeklyMetric?: CreatorWeeklyMetric;
  minWeeklyMetric?: number;
  submissionLimitPerUser?: number;
  submissionRewardLimit?: number;
  oneWinnerPerUser?: boolean;
  publicVisible?: boolean;
  featured?: boolean;
  priority?: number;
  createdAt?: string;
  publishedAt?: string;
  updatedAt?: string;
  deletedAt?: string;
};

export type CreatorRewardAutomation = {
  activities: { enabled: boolean; intervalSeconds: number; startedAt?: string; lastCheckedAt?: string; lastError?: string };
  enabled: true;
  timezone: "UTC";
  weekStartsOn: "monday";
  lastCheckedWeek: string;
  previousWeek: string;
};

type CreatorRewardStore = {
  campaigns: CreatorRewardCampaign[];
  grants: CreatorRewardGrant[];
};

const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "rewards");
const storePath = () => path.join(root(), "creator-rewards.json");
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = () => withDataFileLock("creator-rewards", task);
  const current = lock.then(run, run);
  lock = current.catch(() => undefined);
  return current;
}

async function readStore(): Promise<CreatorRewardStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8")) as Partial<CreatorRewardStore>;
    return {
      campaigns: Array.isArray(parsed.campaigns) && parsed.campaigns.length ? parsed.campaigns : [defaultCampaign()],
      grants: Array.isArray(parsed.grants) ? parsed.grants : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { campaigns: [defaultCampaign()], grants: [] };
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
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000 ? Number(value) : fallback;
}

function validDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("活动时间必须是合法日期");
  return new Date(value).toISOString();
}

function normalizeCampaign(value: Partial<CreatorRewardCampaign>): CreatorRewardCampaign {
  if (value.settlementMode !== undefined && !["weekly", "deadline"].includes(value.settlementMode)) throw new Error("结算模式无效");
  if (value.settlementMode === "deadline") {
    if (!value.startsAt || !value.endsAt) throw new Error("限时活动必须配置开始和截止时间");
    if (!value.boards || value.boards.length < 2 || value.boards.length > 3 || new Set(value.boards.map(b => b.id)).size !== value.boards.length || !value.boards.some(b => b.id === "original") || !value.boards.some(b => b.id === "reduced") || value.boards.some(b => !["original", "verified", "reduced"].includes(b.id))) throw new Error("限时活动须包含完整原数据榜和低档榜，并可增加原图校验中间榜");
    for (const board of value.boards) {
      if (typeof board.name !== "string" || !board.name.trim() || board.name.length > 120 || !Array.isArray(board.rewards) || board.rewards.length !== 3 || [...board.rewards, board.consolationReward].some(n => !Number.isSafeInteger(n) || n < 0 || n > 10_000_000)) throw new Error("榜单名称、前三名和安慰奖配置无效");
    }
    if (!value.scoring || [value.scoring.likes, value.scoring.imports].some(n => !Number.isFinite(n) || n < 0 || n > 1000) || value.scoring.likes + value.scoring.imports <= 0) throw new Error("活动计分权重无效");
    if (value.budget) throw new Error("限时活动不得用预算截断承诺奖励");
  }
  const id = typeof value.id === "string" ? value.id.trim().slice(0, 80) : "default";
  const base = defaultCampaign();
  const startsAt = validDate(value.startsAt);
  const endsAt = validDate(value.endsAt);
  if (value.settlementMode === "deadline" && Date.parse(value.settlesAt || value.endsAt!) < Date.parse(value.endsAt!)) throw new Error("发奖时间不能早于截止时间");
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) throw new Error("活动开始时间必须早于结束时间");
  const weeklyRewards = Array.isArray(value.weeklyRewards) && value.weeklyRewards.length > 0 && value.weeklyRewards.length <= 20
    ? value.weeklyRewards.map((amount) => {
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10_000_000) throw new Error("周榜奖励必须是 0 到 10000000 的整数");
      return amount;
    })
    : base.weeklyRewards;
  const rawBudget = value.budget as number | null | undefined;
  for (const key of ["submissionReward", "budget", "minWeeklyLikes", "minWeeklyMetric", "submissionLimitPerUser", "submissionRewardLimit", "priority"] as const) {
    const amount = value[key];
    if (amount != null && (!Number.isSafeInteger(amount) || amount < 0 || amount > 10_000_000)) throw new Error(`${key} 必须是 0 到 10000000 的整数`);
  }
  const budget = rawBudget === null
    ? undefined
    : rawBudget === undefined
      ? undefined
      : nonNegativeInteger(rawBudget, 0);
  const text = (key: "summary" | "description" | "rules" | "requiredTag", max: number) => typeof value[key] === "string" ? value[key]!.trim().slice(0, max) : "";
  const tagList = (input: unknown, fallback: string[] = []) => (Array.isArray(input) ? input : fallback)
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().slice(0, 100))
    .filter(Boolean)
    .filter((tag, index, items) => items.findIndex((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index)
    .slice(0, 40);
  const legacyRequiredTag = text("requiredTag", 100);
  const rawRequiredTags = Array.isArray(value.requiredTags) && value.requiredTags.length
    ? value.requiredTags
    : legacyRequiredTag ? [legacyRequiredTag] : [];
  const requiredTags = tagList(rawRequiredTags);
  const excludedTags = tagList(value.excludedTags);
  const allowedSources: Array<"other" | "lfn" | "local"> = Array.isArray(value.allowedSources)
    ? value.allowedSources.filter((source): source is "other" | "lfn" | "local" => source === "other" || source === "lfn" || source === "local")
    : ["other", "lfn", "local"];
  if (!allowedSources.length) throw new Error("活动至少需要允许一种作品来源");
  const weeklyMetric = value.weeklyMetric === "downloads" || value.weeklyMetric === "uses" ? value.weeklyMetric : "likes";
  const coverUrl = typeof value.coverUrl === "string" ? value.coverUrl.trim().slice(0, 2000) : "";
  if (coverUrl && !/^https?:\/\//i.test(coverUrl)) throw new Error("活动封面必须是 http 或 https 图片地址");
  if (value.weeklyRewards && (value.weeklyRewards.length < 1 || value.weeklyRewards.length > 20)) throw new Error("周榜支持 1 到 20 个奖励名次");
  if (value.allowedRatings && !value.allowedRatings.length) throw new Error("活动至少需要允许一种作品评级");
  return {
    settlementMode: value.settlementMode || "weekly",
    ...(value.settlementMode === "deadline" ? { timezone: value.timezone === "UTC" ? "UTC" as const : "Asia/Shanghai" as const, settlesAt: validDate(value.settlesAt || value.endsAt), scoring: value.scoring, boards: value.boards, partialPromptBoard: value.partialPromptBoard === "original" ? "original" as const : "reduced" as const } : {}),
    id: id || "default",
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 120) : base.name,
    enabled: typeof value.enabled === "boolean" ? value.enabled : base.enabled,
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    submissionReward: nonNegativeInteger(value.submissionReward, base.submissionReward),
    weeklyRewards,
    ...(budget === undefined ? {} : { budget }),
    summary: text("summary", 300), description: text("description", 12000), rules: text("rules", 12000), requiredTag: requiredTags[0] || "", requiredTags, excludedTags, coverUrl,
    allowedRatings: (value.allowedRatings || ["general", "r13", "r17", "r18"]).filter((rating) => ["general", "r13", "r17", "r18"].includes(rating)),
    allowedSources,
    minWeeklyLikes: nonNegativeInteger(value.minWeeklyLikes, 1),
    weeklyMetric,
    minWeeklyMetric: nonNegativeInteger(value.minWeeklyMetric, nonNegativeInteger(value.minWeeklyLikes, 1)),
    submissionLimitPerUser: nonNegativeInteger(value.submissionLimitPerUser, 0),
    submissionRewardLimit: nonNegativeInteger(value.submissionRewardLimit, 0),
    oneWinnerPerUser: value.oneWinnerPerUser === true,
    publicVisible: value.publicVisible !== false,
    featured: value.featured === true,
    priority: nonNegativeInteger(value.priority, 0),
    createdAt: value.createdAt || new Date().toISOString(),
    publishedAt: value.publishedAt || (value.enabled ? new Date().toISOString() : undefined),
    updatedAt: new Date().toISOString(),
    ...(value.deletedAt ? { deletedAt: value.deletedAt } : {}),
  };
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
  const matching = [...campaigns].sort((a, b) => (b.priority || 0) - (a.priority || 0)).find((campaign) => {
    if (!campaign.enabled || campaign.deletedAt) return false;
    const start = campaign.startsAt ? Date.parse(campaign.startsAt) : Number.NEGATIVE_INFINITY;
    const end = campaign.endsAt ? Date.parse(campaign.endsAt) : Number.POSITIVE_INFINITY;
    return now >= start && now <= end;
  });
  if (matching) return matching;
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

export async function listCreatorRewardCampaigns(includeDeleted = false): Promise<CreatorRewardCampaign[]> {
  const store = await creatorRewardStore();
  return store.campaigns.filter((item) => includeDeleted || !item.deletedAt);
}

export async function publicCreatorRewardCampaigns() {
  const campaigns = await listCreatorRewardCampaigns();
  const now = Date.now();
  return campaigns.filter((item) => item.enabled && item.publicVisible !== false).sort((a, b) => Number(b.featured) - Number(a.featured) || (b.priority || 0) - (a.priority || 0)).map((campaign) => ({ ...campaign, phase: campaign.endsAt && Date.parse(campaign.endsAt) < now ? "已结束" : campaign.startsAt && Date.parse(campaign.startsAt) > now ? "即将开始" : "进行中" }));
}

export async function upsertCreatorRewardCampaign(input: Partial<CreatorRewardCampaign> & { id?: string }): Promise<CreatorRewardCampaign> {
  return withLock(async () => {
    const store = await readStore();
    const id = String(input.id || "default").trim().slice(0, 80) || "default";
    const existing = store.campaigns.find((item) => item.id === id);
    const base = existing || defaultCampaign();
    const definedInput = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const next = normalizeCampaign({ ...base, ...definedInput, id });
    if (existing?.settlementMode === "deadline" && (existing.enabled || existing.publishedAt) && Date.parse(existing.startsAt!) <= Date.now()) {
      const fixed = (c: CreatorRewardCampaign) => JSON.stringify([c.startsAt, c.endsAt, c.settlesAt, c.scoring, c.boards, c.partialPromptBoard, c.requiredTags, c.excludedTags, c.allowedRatings, c.allowedSources, c.oneWinnerPerUser, c.settlementMode]);
      if (fixed(existing) !== fixed(next)) throw new Error("活动已开始，计分、资格、时间与奖励规则已锁定");
    }
    if (existing) store.campaigns[store.campaigns.indexOf(existing)] = next;
    else store.campaigns.push(next);
    await writeStore(store);
    return next;
  });
}

export async function deleteCreatorRewardCampaign(id: string): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const campaign = store.campaigns.find((item) => item.id === id);
    if (!campaign) throw new Error("活动不存在");
    campaign.enabled = false;
    campaign.deletedAt = new Date().toISOString();
    campaign.updatedAt = campaign.deletedAt;
    await writeStore(store);
  });
}

export async function restoreCreatorRewardCampaign(id: string): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const campaign = store.campaigns.find((item) => item.id === id);
    if (!campaign) throw new Error("活动不存在");
    delete campaign.deletedAt;
    campaign.enabled = false;
    campaign.updatedAt = new Date().toISOString();
    await writeStore(store);
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
  campaignId?: string;
}): Promise<CreatorRewardGrant> {
  assertUserId(input.userId);
  assertAmount(input.amount);
  const referenceId = input.referenceId.trim().slice(0, 180);
  if (!referenceId) throw new Error("奖励 referenceId 不能为空");
  return withLock(async () => {
    const store = await readStore();
    const previous = store.grants.find((item) => item.referenceId === referenceId && item.status !== "failed");
    if (previous) {
      if (previous.userId !== input.userId || previous.amount !== input.amount) throw new Error("奖励引用与已保存的收款人或金额不一致");
      await notifyCreatorReward(previous);
      return previous;
    }
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
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    };
    try {
      if (input.campaignId) {
        const campaign = store.campaigns.find((item) => item.id === input.campaignId);
        if (input.kind === "submission" && campaign?.submissionRewardLimit && store.grants.filter((item) => item.kind === "submission" && item.campaignId === input.campaignId && item.status === "granted").length >= campaign.submissionRewardLimit) {
          record.status = "skipped";
          record.error = "活动投稿奖励总次数已达上限";
          store.grants.unshift(record);
          await writeStore(store);
          return record;
        }
        if (input.kind === "submission" && campaign?.submissionLimitPerUser && store.grants.filter((item) => item.kind === "submission" && item.campaignId === input.campaignId && item.userId === input.userId && item.status === "granted").length >= campaign.submissionLimitPerUser) {
          record.status = "skipped";
          record.error = "已达到活动的个人投稿奖励次数上限";
          store.grants.unshift(record);
          await writeStore(store);
          return record;
        }
        const spent = store.grants
          .filter((item) => item.campaignId === input.campaignId && item.status === "granted")
          .reduce((sum, item) => sum + item.amount, 0);
        if (campaign?.budget !== undefined && campaign.budget > 0 && spent + input.amount > campaign.budget) {
          record.status = "skipped";
          record.error = "活动预算已用尽";
          store.grants.unshift(record);
          await writeStore(store);
          return record;
        }
      }
      const result = await grantAffOnce(input.userId, input.amount, record.description, referenceId, "creator-reward");
      // A permanent AFF receipt proves success even when recovering a lost activity record.
      record.status = result.granted || input.kind === "activity" ? "granted" : "skipped";
      store.grants.unshift(record);
      await writeStore(store);
      await notifyCreatorReward(record);
      return record;
    } catch (error) {
      record.error = error instanceof Error ? error.message : "奖励发放失败";
      store.grants.unshift(record);
      await writeStore(store);
      throw error;
    }
  });
}

async function notifyCreatorReward(grant: CreatorRewardGrant): Promise<void> {
  if (grant.status !== "granted" || grant.amount <= 0) return;
  const parts = grant.referenceId.split(":");
  const rank = grant.kind === "weekly" ? grant.description.match(/第\s*(\d+)\s*名/)?.[1] : undefined;
  const href = grant.kind === "activity" ? `/gallery/activities?activity=${encodeURIComponent(parts[1])}` : grant.kind === "weekly" && parts[2]
    ? `/gallery/${encodeURIComponent(parts[2])}?reward=1${rank ? `&rank=${rank}` : ""}`
    : grant.kind === "submission" && parts[2]
      ? `/gallery/${encodeURIComponent(parts[2])}?reward=1`
      : "/profile#profile-rewards";
  const title = grant.kind === "activity" ? "活动奖励已到账" : grant.kind === "weekly" ? "图库周榜奖励已发放" : grant.kind === "submission" ? "图库投稿奖励已到账" : "创作者奖励已发放";
  await createUserNotification({
    userId: grant.userId,
    type: "creator-reward",
    title,
    body: `${grant.description}，已到账 ${grant.amount} AFF。`,
    href,
    dedupeKey: `creator-reward:${grant.kind === "activity" ? grant.referenceId : grant.id}`,
    createdAt: grant.createdAt,
  }).catch((error) => console.error("[lfn] 保存创作者奖励通知失败", error));
}

export async function grantSubmissionReward(userId: number, submissionId: string, actorId?: number): Promise<CreatorRewardGrant> {
  const item = (await listGalleryAdmin()).find((entry) => entry.id === submissionId);
  const campaigns = await listCreatorRewardCampaigns();
  const deadline = item && deadlineCampaignForItem(campaigns, item);
  if (deadline) return { id: `pending:${deadline.id}:${submissionId}`, kind: "submission", userId, amount: 0, description: "限时活动奖励将在结榜时统一发放", referenceId: `deadline-pending:${deadline.id}:${submissionId}`, status: "skipped", createdAt: new Date().toISOString(), campaignId: deadline.id };
  const campaign = activeCampaign(campaigns.filter((entry) => entry.settlementMode !== "deadline" && campaignAllowsItem(entry, item)));
  return grantCreatorReward({
    kind: "submission",
    userId,
    amount: campaign.submissionReward,
    description: `${campaign.name}：投稿奖励`,
    referenceId: `creator-submission:${campaign.id}:${submissionId}`,
    actorId,
    campaignId: campaign.id,
  });
}

export function campaignAllowsItem(campaign: CreatorRewardCampaign, item: Pick<GalleryItem, "tags" | "rating" | "source"> | undefined): boolean {
  const itemTags = new Set((item?.tags || []).map(canonicalGalleryTag));
  const requiredTags = campaign.requiredTags?.length ? campaign.requiredTags : campaign.requiredTag ? [campaign.requiredTag] : [];
  if (requiredTags.some((tag) => !itemTags.has(canonicalGalleryTag(tag)))) return false;
  if (campaign.excludedTags?.some((tag) => itemTags.has(canonicalGalleryTag(tag)))) return false;
  if (campaign.allowedRatings?.length && item && !campaign.allowedRatings.includes(item.rating)) return false;
  if (campaign.allowedSources?.length && item && !campaign.allowedSources.includes(item.source)) return false;
  return true;
}

export function deadlineCampaignForItem(campaigns: CreatorRewardCampaign[], item: Pick<GalleryItem, "submittedAt" | "tags" | "rating" | "source">) {
  return campaigns.find(c => c.settlementMode === "deadline" && (c.enabled || c.publishedAt) && campaignAllowsItem(c, item) && Date.parse(item.submittedAt) >= Date.parse(c.startsAt!) && Date.parse(item.submittedAt) < Date.parse(c.endsAt!));
}

export async function settleWeeklyCreatorRewards(week = galleryWeekKey(new Date(Date.now() - 7 * 24 * 3600_000))): Promise<{
  week: string;
  items: CreatorRewardGrant[];
}> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || galleryWeekKey(new Date(`${week}T00:00:00.000Z`)) !== week)
    throw new Error("周榜起点必须是 UTC 周一日期");
  const weekEnd = new Date(Date.parse(`${week}T00:00:00.000Z`) + 7 * 86_400_000 - 1);
  const campaigns = await listCreatorRewardCampaigns();
  const campaign = activeCampaign(campaigns.filter(c => c.settlementMode !== "deadline"), weekEnd.getTime());
  const gallery = await listGalleryAdmin();
  const metricFor = (item: GalleryItem) => campaign.weeklyMetric === "downloads"
    ? item.weeklyDownloads?.[week] || 0
    : campaign.weeklyMetric === "uses"
      ? item.weeklyUses?.[week] || 0
      : item.weeklyLikes?.[week] || 0;
  const minimum = campaign.minWeeklyMetric ?? campaign.minWeeklyLikes ?? 1;
  const ranked = gallery.filter((item) => item.status === "approved" && !deadlineCampaignForItem(campaigns, item) && campaignAllowsItem(campaign, item) && metricFor(item) >= minimum && metricFor(item) > 0)
    .sort((a, b) => metricFor(b) - metricFor(a) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const eligible = campaign.oneWinnerPerUser
    ? ranked.filter((item, index, list) => list.findIndex((candidate) => candidate.ownerId === item.ownerId) === index)
    : ranked;
  const winners = eligible.slice(0, campaign.enabled ? campaign.weeklyRewards.length : 0);
  const items: CreatorRewardGrant[] = [];
  for (const [index, item] of winners.entries()) {
    items.push(await grantCreatorReward({
      kind: "weekly",
      userId: item.ownerId,
      amount: campaign.weeklyRewards[index] || 0,
      description: `${campaign.name}：图库周榜第 ${index + 1} 名`,
      referenceId: `gallery-week:${week}:${item.id}`,
      campaignId: campaign.id,
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

let automaticSettlementTimer: ReturnType<typeof setInterval> | undefined;
let automaticSettlementLastCheck = "";
let automaticSettlementInFlight: Promise<{ week: string; items: CreatorRewardGrant[] }> | undefined;
const activityRuntime = globalThis as typeof globalThis & { __lfnActivityAutomation?: { startedAt: string; lastCheckedAt?: string; lastError?: string } };
let automaticActivitiesInFlight: Promise<unknown> | undefined;

export function creatorRewardAutomation(now = Date.now()): CreatorRewardAutomation {
  const previousWeek = galleryWeekKey(new Date(now - 7 * 24 * 3600_000));
  return { enabled: true, timezone: "UTC", weekStartsOn: "monday", lastCheckedWeek: automaticSettlementLastCheck, previousWeek, activities: { enabled: Boolean(activityRuntime.__lfnActivityAutomation), intervalSeconds: 30, ...activityRuntime.__lfnActivityAutomation } };
}

export async function settlePreviousCreatorRewardWeek(now = Date.now()): Promise<{ week: string; items: CreatorRewardGrant[] }> {
  const week = galleryWeekKey(new Date(now - 7 * 24 * 3600_000));
  if (automaticSettlementLastCheck === week) return { week, items: [] };
  if (automaticSettlementInFlight) return automaticSettlementInFlight;
  automaticSettlementInFlight = settleWeeklyCreatorRewards(week).then((result) => {
    automaticSettlementLastCheck = week;
    return result;
  }).finally(() => {
    automaticSettlementInFlight = undefined;
  });
  return automaticSettlementInFlight;
}

export function startAutomaticCreatorRewardSettlement(): void {
  if (automaticSettlementTimer) return;
  void settlePreviousCreatorRewardWeek().catch((error) => console.error("[lfn] 自动结算周榜失败", error));
  activityRuntime.__lfnActivityAutomation = { startedAt: new Date().toISOString() };
  console.info("[lfn] 活动自动结算任务已启动，每 30 秒检查到期活动，启动时补偿未完成结算");
  const settleActivities = () => {
    if (automaticActivitiesInFlight) return automaticActivitiesInFlight;
    automaticActivitiesInFlight = import("@/lib/activity-leaderboards").then(module => module.settleDueActivities()).then(() => {
      activityRuntime.__lfnActivityAutomation!.lastCheckedAt = new Date().toISOString();
      delete activityRuntime.__lfnActivityAutomation!.lastError;
    }).catch(error => {
      activityRuntime.__lfnActivityAutomation!.lastError = error instanceof Error ? error.message : "结算失败";
      console.error("[lfn] 活动自动结算失败", error);
    }).finally(() => { automaticActivitiesInFlight = undefined; });
    return automaticActivitiesInFlight;
  };
  void settleActivities();
  automaticSettlementTimer = setInterval(() => {
    void settlePreviousCreatorRewardWeek().catch((error) => console.error("[lfn] 自动结算周榜失败", error));
    void settleActivities();
  }, 30_000);
  automaticSettlementTimer.unref?.();
}
