import type { TutorialOverride } from "./types";

export const tutorialOverride: TutorialOverride = {
  preparation: "登录账号。钱包、签到状态与兑换记录会随账号和站点配置变化；实际奖励、额度用途和购买价格以页面显示为准。",
  summary: "查看钱包余额，了解每日签到与兑换码，再用使用记录核对创作消费。",
  steps: {
    0: {
      title: "查看钱包与创作额度",
      body: "在「钱包与图包」中查看 NewAPI 余额、个人 AFF 与图包额度。不同额度适用的功能和扣费来源可能不同，按页面说明核对当前账号的可用额度。",
      tip: "余额或额度有疑问时，先确认登录账号，再对照钱包说明和奖励流水。",
      target: "#profile-wallet",
      keywords: ["钱包与图包", "NewAPI 余额", "个人 AFF", "图包额度", "扣费来源", "当前账号", "钱包说明", "奖励流水"],
      screenshot: { src: "/tutorials/wallet/desktop-step-01.png", alt: "个人资料页的钱包与图包卡片，显示余额、个人 AFF 和图包额度", width: 1440, height: 1000, caption: "本地实际页面截图 · 查看钱包与创作额度" },
    },
    1: {
      title: "查看每日签到状态",
      body: "在「每日签到」卡片查看今日签到状态、奖励数额和签到规则。签到成功后奖励进入个人 AFF；中国标准时间每天可签到一次。",
      tip: "签到按钮会提交签到请求。先核对奖励和今日状态，避免重复操作。",
      target: ".profile-checkin-card",
      keywords: ["每日签到", "今日签到状态", "奖励数额", "签到规则", "个人 AFF", "中国标准时间", "提交签到请求", "重复操作"],
      screenshot: { src: "/tutorials/wallet/desktop-step-02.png", alt: "个人资料页的每日签到卡片，显示签到奖励和今日状态", width: 1440, height: 1000, caption: "本地实际页面截图 · 查看每日签到状态" },
    },
    2: {
      title: "查看兑换码与兑换记录",
      body: "在「兑换码」区域输入你持有的有效代码，再由你确认兑换。LFN 兑换码会增加个人 AFF，NewAPI 兑换码会增加 NewAPI 余额；成功后可在下方查看脱敏兑换记录。",
      tip: "每个兑换码只能由同一账号兑换一次；兑换会提交请求，教程审计不会替你提交。",
      target: "#profile-redeem",
      keywords: ["兑换码", "有效代码", "确认兑换", "LFN 兑换码", "个人 AFF", "NewAPI 兑换码", "NewAPI 余额", "脱敏兑换记录", "只能", "不会替你提交"],
      screenshot: { src: "/tutorials/wallet/desktop-step-03.png", alt: "个人资料页的兑换码表单和兑换记录", width: 1440, height: 1000, caption: "本地实际页面截图 · 查看兑换码与兑换记录" },
    },
    3: {
      title: "核对使用记录与费用",
      body: "打开使用记录，按模型、状态、付款来源或日期范围核对每次调用的费用与结果。使用自带 API 时，上游费用和限额还需到对应服务商处核对。",
      tip: "请求状态、扣费来源和时间范围都可能影响账单核对结果。",
      target: ".usage-filter-card",
      keywords: ["使用记录", "模型", "状态", "付款来源", "日期范围", "每次调用", "费用", "结果", "自带 API", "上游费用", "服务商", "账单核对"],
      screenshot: { src: "/tutorials/wallet/desktop-step-04.png", alt: "使用记录页的模型、状态、来源与付款筛选区域", width: 1440, height: 1000, caption: "本地实际页面截图 · 核对使用记录与费用" },
    },
  },
};
