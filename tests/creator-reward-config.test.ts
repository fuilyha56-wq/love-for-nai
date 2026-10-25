import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { grantCreatorReward, listCreatorRewardGrants, publicCreatorRewardCampaigns, settleWeeklyCreatorRewards, upsertCreatorRewardCampaign } from "@/lib/creator-rewards";

const originalDataDir = process.env.LFN_DATA_DIR;

async function prepareData(items: unknown[] = []) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lfn-creator-config-"));
  process.env.LFN_DATA_DIR = dir;
  await mkdir(path.join(dir, "gallery"), { recursive: true });
  await writeFile(path.join(dir, "gallery", "index.json"), JSON.stringify({ items }), "utf8");
  return dir;
}

afterEach(() => {
  if (originalDataDir == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

describe("creator reward campaign controls", () => {
  it("normalizes advanced eligibility, ranking, and visibility options", async () => {
    await prepareData();
    const campaign = await upsertCreatorRewardCampaign({
      id: "featured",
      name: "精选活动",
      enabled: true,
      requiredTags: [" blue ", "portrait", "BLUE"],
      excludedTags: ["spoiler"],
      allowedSources: ["lfn"],
      weeklyMetric: "uses",
      minWeeklyMetric: 12,
      submissionRewardLimit: 40,
      oneWinnerPerUser: true,
      publicVisible: false,
      featured: true,
    });
    expect(campaign).toMatchObject({
      requiredTag: "blue",
      requiredTags: ["blue", "portrait"],
      excludedTags: ["spoiler"],
      allowedSources: ["lfn"],
      weeklyMetric: "uses",
      minWeeklyMetric: 12,
      submissionRewardLimit: 40,
      oneWinnerPerUser: true,
      publicVisible: false,
      featured: true,
    });
    await expect(publicCreatorRewardCampaigns()).resolves.not.toContainEqual(expect.objectContaining({ id: "featured" }));
  });

  it("ranks qualifying weekly entries by uses and caps winners per user", async () => {
    await prepareData([
      { id: "a1", ownerId: 10, ownerName: "a", authorName: "a", title: "a1", rating: "r13", source: "lfn", tags: ["blue", "portrait"], prompt: "", negativePrompt: "", parameters: {}, imageFile: "a1.png", createdAt: "2026-10-17T00:00:00.000Z", likes: 0, likedBy: [], weeklyUses: { "2026-10-12": 20 }, status: "approved" },
      { id: "a2", ownerId: 10, ownerName: "a", authorName: "a", title: "a2", rating: "r13", source: "lfn", tags: ["blue", "portrait"], prompt: "", negativePrompt: "", parameters: {}, imageFile: "a2.png", createdAt: "2026-10-16T00:00:00.000Z", likes: 0, likedBy: [], weeklyUses: { "2026-10-12": 18 }, status: "approved" },
      { id: "b1", ownerId: 20, ownerName: "b", authorName: "b", title: "b1", rating: "r13", source: "lfn", tags: ["blue", "portrait"], prompt: "", negativePrompt: "", parameters: {}, imageFile: "b1.png", createdAt: "2026-10-15T00:00:00.000Z", likes: 0, likedBy: [], weeklyUses: { "2026-10-12": 15 }, status: "approved" },
      { id: "excluded", ownerId: 30, ownerName: "c", authorName: "c", title: "c", rating: "r13", source: "lfn", tags: ["blue", "portrait", "spoiler"], prompt: "", negativePrompt: "", parameters: {}, imageFile: "c.png", createdAt: "2026-10-15T00:00:00.000Z", likes: 0, likedBy: [], weeklyUses: { "2026-10-12": 99 }, status: "approved" },
    ]);
    await upsertCreatorRewardCampaign({ id: "weekly", name: "周榜", enabled: true, priority: 100, startsAt: "2026-10-12T00:00:00Z", endsAt: "2026-10-19T00:00:00Z", weeklyRewards: [100, 50], weeklyMetric: "uses", minWeeklyMetric: 10, requiredTags: ["blue", "portrait"], excludedTags: ["spoiler"], allowedSources: ["lfn"], allowedRatings: ["r13"], oneWinnerPerUser: true });

    const result = await settleWeeklyCreatorRewards("2026-10-12");
    expect(result.items.map((item) => [item.userId, item.amount])).toEqual([[10, 100], [20, 50]]);
    expect((await listCreatorRewardGrants()).filter((item) => item.kind === "weekly")).toHaveLength(2);
  });

  it("enforces the campaign-wide submission award count", async () => {
    await prepareData();
    await upsertCreatorRewardCampaign({ id: "limited", submissionRewardLimit: 1 });
    await expect(grantCreatorReward({ kind: "submission", userId: 1, amount: 10, description: "first", referenceId: "submission:first", campaignId: "limited" })).resolves.toMatchObject({ status: "granted" });
    await expect(grantCreatorReward({ kind: "submission", userId: 2, amount: 10, description: "second", referenceId: "submission:second", campaignId: "limited" })).resolves.toMatchObject({ status: "skipped", error: "活动投稿奖励总次数已达上限" });
  });
});
