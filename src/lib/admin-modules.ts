import { getPlatformCapabilities, type PlatformCapabilities } from "@/lib/platform";

export type AdminModuleId =
  | "overview"
  | "users"
  | "credits"
  | "announcements"
  | "gallery"
  | "referrals"
  | "platform";

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
  ];
}
