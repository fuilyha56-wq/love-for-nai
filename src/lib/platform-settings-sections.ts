import type { RuntimeSettings } from "@/lib/runtime-config";

export type SettingsPage =
  | "platform"
  | "authentication"
  | "services"
  | "billing"
  | "image-policy"
  | "network";
type Field = {
  key: keyof RuntimeSettings;
  label: string;
  hint?: string;
  type?: "switch" | "number" | "secret" | "textarea" | "select";
  min?: number;
  step?: string;
  dependsOn?: keyof RuntimeSettings;
  editableWhenInactive?: boolean;
};
type Group = { title: string; description?: string; fields: Field[] };
export const SETTINGS_PAGES: Array<{
  id: SettingsPage | "endpoints" | "gateway";
  label: string;
  description: string;
}> = [
  {
    id: "authentication",
    label: "注册与登录",
    description: "管理登录方式、注册入口、邮箱验证和域名限制",
  },
  {
    id: "services",
    label: "服务接入",
    description: "配置账号系统、NewAPI 和图像服务连接",
  },
  {
    id: "endpoints",
    label: "端点管理",
    description: "添加、启停和切换认证、图像与钱包端点",
  },
  {
    id: "billing",
    label: "额度与奖励",
    description: "管理图包价格、每日计费、签到与邀请奖励",
  },
  {
    id: "image-policy",
    label: "模型与签名",
    description: "设置模型开放范围和图片来源签名",
  },
  {
    id: "network",
    label: "网络与存储",
    description: "配置代理、Cookie 安全和远程历史",
  },
  {
    id: "gateway",
    label: "Gateway 运营",
    description: "管理渠道池、账号健康与模型计费覆盖",
  },
];

export const SETTINGS_GROUPS: Record<SettingsPage, Group[]> = {
  platform: [
    {
      title: "基础站点",
      description: "站点地址与公开链接。其他设置可从下方分类进入。",
      fields: [
        {
          key: "publicUrl",
          label: "公开地址",
          hint: "用于邀请链接等站点对外地址。",
        },
        { key: "sourceCodeUrl", label: "源码地址" },
      ],
    },
  ],
  authentication: [
    {
      title: "登录方式",
      description: "关闭后隐藏对应登录入口，同时拒绝该方式的登录请求。",
      fields: [
        {
          key: "passwordLoginEnabled",
          label: "允许用户使用密码登录",
          type: "switch",
          hint: "包含密码登录后的两步验证流程。",
        },
        {
          key: "tokenLoginEnabled",
          label: "允许使用访问令牌登录",
          type: "switch",
          hint: "适用于 NewAPI 账号；本地账号不支持访问令牌。",
        },
      ],
    },
    {
      title: "注册方式",
      description:
        "只显示已启用的方式。邮箱与邀请码可以单独开放，也可以同时开放。",
      fields: [
        {
          key: "registrationEnabled",
          label: "允许新用户注册",
          type: "switch",
          hint: "注册总开关，关闭后所有注册入口和验证码发送均关闭。",
        },
        {
          key: "passwordRegistrationEnabled",
          label: "允许使用密码注册",
          type: "switch",
          dependsOn: "registrationEnabled",
          hint: "现有邮箱与邀请码注册均创建密码账号，关闭此项会停用这两种方式。",
        },
        {
          key: "emailRegistrationEnabled",
          label: "允许使用邮箱注册",
          type: "switch",
          dependsOn: "registrationEnabled",
          hint: "使用用户名、密码和邮箱创建账号。",
        },
        {
          key: "inviteRegistrationEnabled",
          label: "允许使用邀请码注册",
          type: "switch",
          dependsOn: "registrationEnabled",
          hint: "开放邀请码注册方式；是否要求所有注册填写邀请码由独立的注册门槛决定。",
        },
      ],
    },
    {
      title: "注册门槛",
      description: "独立于登录和注册方式，控制所有新用户的注册资格。",
      fields: [
        {
          key: "requireInviteCode",
          label: "注册必须填写邀请码（仅限邀请）",
          type: "switch",
          dependsOn: "registrationEnabled",
          hint: "开启后，邮箱等所有注册方式都必须填写有效邀请码；不会关闭任何登录方式或注册入口。",
        },
      ],
    },
    {
      title: "邮箱与身份验证",
      description:
        "所有注册方式都需要用户名和至少 8 位密码。启用邮箱验证后，邀请码注册也必须验证邮箱。",
      fields: [
        {
          key: "requireEmailVerification",
          label: "要求新账户验证邮箱",
          type: "switch",
        },
        {
          key: "emailDomainRestrictionEnabled",
          label: "仅允许特定的电子邮件域名",
          type: "switch",
        },
        {
          key: "blockEmailAliases",
          label: "阻止电子邮件别名",
          type: "switch",
          hint: "拦截 user+alias@domain.com、Gmail 点号别名及 googlemail.com 别名。",
        },
        {
          key: "allowedEmailDomains",
          label: "允许的邮箱域名",
          type: "textarea",
          dependsOn: "emailDomainRestrictionEnabled",
          editableWhenInactive: true,
          hint: "关闭限制时也可编辑并保存；打开后按完整域名匹配。每行一个域名。",
        },
      ],
    },
    {
      title: "注册邮件服务",
      description:
        "NewAPI 账号默认沿用上游邮箱验证（上游需开启验证）。本地账号，或希望由本站发送邮件时，请配置 SMTP。",
      fields: [
        {
          key: "smtpHost",
          label: "SMTP 服务器",
          hint: "例如 smtp.qq.com；留空时 NewAPI 账号沿用上游邮件服务。",
        },
        { key: "smtpPort", label: "SMTP 端口", type: "number", min: 1 },
        { key: "smtpUser", label: "SMTP 用户名" },
        { key: "smtpPassword", label: "SMTP 密码 / 授权码", type: "secret" },
        { key: "smtpFrom", label: "发件人邮箱" },
        {
          key: "smtpSecure",
          label: "使用直接 TLS 连接（通常为 465 端口）",
          type: "switch",
          hint: "关闭时使用 STARTTLS（通常为 587 端口）。",
        },
      ],
    },
  ],
  services: [
    {
      title: "账号系统与钱包",
      fields: [
        { key: "authProvider", label: "账号提供者", type: "select" },
        { key: "newApiBaseUrl", label: "NewAPI 地址" },
        { key: "newApiAdminUserId", label: "NewAPI 管理员用户 ID" },
        {
          key: "newApiAdminToken",
          label: "NewAPI 管理员令牌",
          type: "secret",
          hint: "邀请码免邮箱验证、本站 SMTP 验证或关闭邮箱验证时，由服务端创建普通账号，需要管理员令牌。",
        },
      ],
    },
    {
      title: "图像服务连接",
      description: "实际出图服务在「端点管理」中启用。Gateway 为可选接入。",
      fields: [
        { key: "affGatewayUrl", label: "Gateway 地址（可选）" },
        { key: "affGatewayToken", label: "Gateway 令牌", type: "secret" },
        { key: "naiApiUrl", label: "第三方 API 站点" },
        { key: "naiApiToken", label: "第三方 API 令牌", type: "secret" },
        {
          key: "naiImageApiUrl",
          label: "独立图像 API 地址（可选）",
          hint: "留空时沿用第三方 API 站点。",
        },
        { key: "naiImageApiToken", label: "独立图像 API 令牌", type: "secret" },
        { key: "imageProviderUrl", label: "OpenAI 兼容图像上游（可选）" },
        {
          key: "imageProviderToken",
          label: "兼容图像上游令牌",
          type: "secret",
        },
      ],
    },
  ],
  billing: [
    {
      title: "余额与图包",
      fields: [
        {
          key: "quotaPerUnit",
          label: "余额单位（quota / $1）",
          type: "number",
          min: 1,
        },
        {
          key: "imagePackageAffPerPackage",
          label: "每包图包额度（AFF）",
          type: "number",
          min: 1,
          step: "any",
        },
        {
          key: "imagePackageRateLimit",
          label: "图包每分钟消耗限制（张）",
          type: "number",
          min: 1,
        },
        {
          key: "imagePackagePriceUsd",
          label: "每包图包价格（美元）",
          type: "number",
          min: 0.01,
          step: "0.01",
        },
      ],
    },
    {
      title: "签到与邀请奖励",
      description: "邀请奖励与邀请码注册独立配置，关闭奖励不会关闭邀请码注册。",
      fields: [
        { key: "enableDailyCheckIn", label: "开启每日签到", type: "switch" },
        {
          key: "dailyCheckInReward",
          label: "每日签到奖励（AFF）",
          type: "number",
          min: 0,
          step: "any",
          dependsOn: "enableDailyCheckIn",
        },
        { key: "enableReferral", label: "开启邀请奖励", type: "switch" },
        {
          key: "referralReward",
          label: "邀请奖励（邀请人与新用户各得 AFF）",
          type: "number",
          min: 0,
          step: "any",
          dependsOn: "enableReferral",
        },
      ],
    },
  ],
  "image-policy": [
    {
      title: "模型开放范围",
      description: "关闭后从模型列表下架，并拒绝对应模型的请求。",
      fields: [
        { key: "enableV5Models", label: "启用 V5 模型", type: "switch" },
        { key: "enableV45Models", label: "启用 V4.5 模型", type: "switch" },
      ],
    },
    {
      title: "图片来源签名",
      description:
        "签名写入 PNG 元数据。请使用原始文件校验，重新编码可能移除元数据。",
      fields: [
        { key: "watermarkEnabled", label: "启用图片签名", type: "switch" },
        {
          key: "watermarkIssuer",
          label: "签名发行方",
          dependsOn: "watermarkEnabled",
        },
        {
          key: "watermarkLabel",
          label: "签名标签",
          dependsOn: "watermarkEnabled",
        },
        {
          key: "watermarkNote",
          label: "签名附加说明",
          dependsOn: "watermarkEnabled",
        },
      ],
    },
  ],
  network: [
    {
      title: "网络与 Cookie",
      fields: [
        {
          key: "outboundProxy",
          label: "出站代理",
          hint: "例如 http://host:port",
        },
        {
          key: "trustProxy",
          label: "信任反向代理 X-Forwarded-For",
          type: "switch",
        },
        { key: "cookieSecure", label: "Cookie 仅 HTTPS", type: "switch" },
      ],
    },
    {
      title: "远程历史存储",
      fields: [
        { key: "remoteHistoryUrl", label: "远程历史地址" },
        { key: "remoteHistoryToken", label: "远程历史令牌", type: "secret" },
      ],
    },
  ],
};
