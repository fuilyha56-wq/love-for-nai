import type { CreatorRewardCampaign } from "@/lib/creator-rewards";

export const defaultActivityBoards: NonNullable<
  CreatorRewardCampaign["boards"]
> = [
  {
    id: "original",
    name: "完整原数据公开榜",
    rewards: [3000, 1000, 100],
    consolationReward: 50,
  },
  {
    id: "verified",
    name: "原图校验榜（0.3 倍）",
    rewards: [900, 300, 30],
    consolationReward: 15,
  },
  {
    id: "reduced",
    name: "非完整原数据公开榜",
    rewards: [300, 100, 10],
    consolationReward: 5,
  },
];
export function halloween2026Campaign(startsAt: string): CreatorRewardCampaign {
  return {
    id: "halloween-2026",
    name: "LFN 2026 万圣节投稿活动",
    enabled: true,
    publicVisible: true,
    featured: true,
    priority: 100,
    settlementMode: "deadline",
    timezone: "Asia/Shanghai",
    startsAt,
    endsAt: "2026-11-06T16:00:00.000Z",
    settlesAt: "2026-11-06T16:00:00.000Z",
    requiredTag: "万圣节",
    requiredTags: ["万圣节"],
    excludedTags: [],
    allowedSources: ["other", "lfn", "local"],
    allowedRatings: ["general", "r13", "r17", "r18"],
    submissionReward: 0,
    weeklyRewards: [0, 0, 0],
    scoring: { likes: 1, imports: 1 },
    boards: structuredClone(defaultActivityBoards),
    partialPromptBoard: "reduced",
    oneWinnerPerUser: true,
    summary:
      "带上万圣节标签投稿，按有效点赞与导入综合排名，三档榜单 AFF 奖励将于 11 月 7 日自动发放。",
    description:
      "万圣节创作活动开始啦！投稿带上“万圣节”或 halloween 标签即可参赛。可上传修改后的参赛图，并另外提供携带元数据的私有原图用于校验和审核，进入 0.3 倍中间档。",
    rules:
      "北京时间 2026 年 11 月 7 日 00:00 截止投稿、计票并开始自动发奖。\n综合分 = 活动有效点赞数 + 活动有效导入数。同分按有效点赞数、参赛时间较早、作品 ID 排序。\n完整公开可验证原数据且非超分：前三名 3000 / 1000 / 100 AFF，安慰奖 50 AFF。\n提供携带有效原始元数据的校验原图及修改后参赛图，经来源校验和关联审核后：前三名 900 / 300 / 30 AFF，安慰奖 15 AFF。广场只展示修改后的参赛图，校验原图仅管理员可见。\n未提供合格校验原图的部分公开、不公开、无原数据或超分：前三名 300 / 100 / 10 AFF，安慰奖 5 AFF。部分公开须通过原图提示词删减校验。\n每账号每作品最多一个有效点赞、一次有效导入；取消点赞扣分，作者自身互动不计分。下载与浏览不算导入。\n只统计活动开始后投稿且截止前审核通过的作品。每位作者每榜以最高分作品参加奖励排名，其他作品可展示但不重复领奖。\n每人每榜最多一份奖励；前三名不叠加安慰奖，其余合格作者每榜各领一次安慰奖，无最低互动门槛。可用不同作品参加三个榜单。\n本活动不另发审核投稿奖或重复周榜奖。无原数据图自动归类，可正常作为图片或参考图导入。",
  };
}
