import { getPlatformCapabilities, type PlatformCapabilities } from "@/lib/platform";

export type AdminModuleId = "overview" | "users" | "announcements";

export type AdminModule = {
  id: AdminModuleId;
  label: string;
  description: string;
  enabled: boolean;
};

export function listAdminModules(
  capabilities: PlatformCapabilities = getPlatformCapabilities(),
): AdminModule[] {
  return [
    {
      id: "overview",
      label: "平台概览",
      description: "查看当前接入的账号、图像和计费能力，不绑定某一家上游。",
      enabled: capabilities.admin.platform,
    },
    {
      id: "users",
      label: "用户管理",
      description: capabilities.auth.provider === "newapi"
        ? "管理上游账号、分组和余额。"
        : "管理本地账号、角色和创作额度。",
      enabled: capabilities.admin.users,
    },
    {
      id: "announcements",
      label: "公告管理",
      description: "站点公告与评论，始终存储在 LFN 本地。",
      enabled: capabilities.admin.announcements,
    },
  ];
}
