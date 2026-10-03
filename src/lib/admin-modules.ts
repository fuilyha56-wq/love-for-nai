import { getPlatformCapabilities, type PlatformCapabilities } from "@/lib/platform";

export type AdminModuleId =
  | "overview"
  | "users"
  | "sessions"
  | "credits"
  | "announcements"
  | "gallery"
  | "referrals"
  | "audits"
  | "platform"
  | "docs"
  | "creator"
  | "rewards"
  | "redeem";

export type AdminModule = {
  id: AdminModuleId;
  label: string;
  description: string;
  enabled: boolean;
};

export function listAdminModules(
  capabilities: PlatformCapabilities = getPlatformCapabilities(),
): AdminModule[] {
  const creditLabel = capabilities.labels.credits;
  return [
    {
      id: "overview",
      label: "平台概览",
      description: "站点健康、接入能力和运营数字。不绑定某一家上游。",
      enabled: capabilities.admin.platform,
    },
    {
      id: "users",
      label: "用户管理",
      description: capabilities.auth.provider === "newapi"
        ? "搜索账号、改资料、分组、上游余额和创作额度。"
        : "搜索本地账号，改资料、角色、停用状态和创作额度。",
      enabled: capabilities.admin.users,
    },
    {
      id: "sessions",
      label: "会话管理",
      description: "查看活跃会话数，告警并批量撤销超过 25 个活跃会话的用户。",
      enabled: capabilities.auth.provider === "newapi",
    },
    {
      id: "credits",
      label: `${creditLabel} 账本`,
      description: `查看个人${creditLabel}与图包额度，发放或回收，并核对流水。`,
      enabled: capabilities.admin.credits,
    },
    {
      id: "announcements",
      label: "公告管理",
      description: "发布、置顶、编辑站点公告，并管理评论。公告始终存在 LFN 本地。",
      enabled: capabilities.admin.announcements,
    },
    {
      id: "gallery",
      label: "图库管理",
      description: "查看投稿、改评级/标题，或下架作品。",
      enabled: true,
    },
    {
      id: "referrals",
      label: "邀请记录",
      description: "查看邀请码、邀请人和已注册人数。",
      enabled: true,
    },
    {
      id: "platform",
      label: "平台配置",
      description: "用 LFN 控件改账号、图像、钱包上游和全部站点环境项，保存后立即生效。",
      enabled: capabilities.admin.platform,
    },
    {
      id: "docs",
      label: "文档管理",
      description: "线上编辑 API 与帮助文档，自动保存草稿并即时发布。",
      enabled: capabilities.admin.platform,
    },
    {
      id: "creator",
      label: "投稿审核",
      description: "处理创作者投稿、审核状态、拒绝原因和公开作品。",
      enabled: true,
    },
    {
      id: "rewards",
      label: "奖励与活动",
      description: "结算投稿/周榜奖励，管理活动和额度发放记录。",
      enabled: capabilities.admin.credits,
    },
    {
      id: "redeem",
      label: "兑换码",
      description: "批量生成、停用和追踪创作额度兑换码。",
      enabled: capabilities.admin.credits,
    },
  ];
}
