import type { TutorialOverride } from "./types";

const shot = (step: number, alt: string) => ({
  src: `/tutorials/api-access/step-${String(step).padStart(2, "0")}.png`,
  alt,
  width: 1440,
  height: 1000,
  caption: "本地运行的 Love for NAI 实际操作界面截图",
});

export const tutorialOverride: TutorialOverride = {
  preparation: "使用本地练习账号。此教程的创建与客户端检查均由本地浏览器 fixture 模拟，不会保存或传播密钥，也不会提交真实生成请求。",
  summary: "打开 LFN 对外 API 密钥管理，安全创建密钥，选择 NAI 原生或 OpenAI 兼容协议，并用只读模型目录检查客户端连通。",
  steps: {
    0: {
      title: "打开 LFN 对外 API 密钥",
      body: "在设置的「模型与密钥」页面找到 API 密钥管理。这里的 LFN 对外图像 Key 供外部客户端调用 /ai 与 /v1；它不同于导入图像来源时使用的上游 Key，也不同于网页登录凭据。",
      tip: "真实创建会向 NewAPI 保存密钥。本教程使用本地 fixture 演示，不会触达上游密钥服务。",
      path: "/settings#api-tokens",
      target: "#api-tokens",
      keywords: ["模型与密钥", "API 密钥管理", "LFN 对外图像 Key", "/ai", "/v1", "上游 Key", "网页登录凭据", "本地 fixture"],
      screenshot: shot(1, "设置页的 LFN 对外 API 密钥管理区域"),
    },
    1: {
      title: "创建并妥善保管密钥",
      body: "点击「创建密钥」，填写易于辨认的名称，按需选择分组、额度、有效期及模型限制。保存后只在可信设备查看和复制完整密钥；不要放进 URL、公开截图、提示词或共享项目。",
      tip: "演示创建由 route fixture 拦截并返回假记录，不会写入服务端或上游。请勿把真实密钥输入本地审计页面。",
      path: "/settings#api-tokens",
      target: "#api-tokens form label:first-child",
      keywords: ["创建密钥", "名称", "分组", "额度", "有效期", "模型限制", "可信设备", "公开截图", "route fixture", "假记录"],
      screenshot: shot(2, "API 密钥管理页面中已展开的创建表单"),
    },
    2: {
      title: "按客户端选择接入协议",
      body: "在文档中按客户端选择 NAI 原生 /ai 或 OpenAI 兼容 /v1。NAI Launcher 使用站点根地址和图像 API Token；OpenAI Images 客户端通常将 Base URL 设为站点根地址加 /v1。模型名、端点和返回格式以对应文档为准。",
      tip: "仅填写客户端约定的站点地址和密钥；通常 API Key 字段只填密钥本身，不加 Bearer 前缀。手写 Authorization 请求头时才使用 Bearer。",
      path: "/docs?slug=api-keys-and-clients",
      target: "article",
      keywords: ["NAI 原生", "/ai", "OpenAI 兼容", "/v1", "NAI Launcher", "站点根地址", "图像 API Token", "Bearer", "Authorization"],
      screenshot: shot(3, "创建密钥与外部客户端文档中的协议选择说明"),
    },
    3: {
      title: "用只读模型目录验证连通",
      body: "先用只读模型目录请求 GET /v1/models，确认站点根地址、/v1 路径、Bearer 鉴权和模型目录可用。审计时该请求由本地 route fixture 返回假模型清单，不会联系外网或实际 API。确认连通后，平时再按客户端文档发送小尺寸图片请求，并检查使用记录。",
      tip: "出图 POST 会产生真实任务或费用；本教程审计不发送生成请求。若出现 401 检查 Key，404 检查是否重复拼接 /v1，问题仍在时按排查文档记录请求 ID 并脱敏反馈。",
      path: "/docs?slug=troubleshooting",
      target: "article",
      keywords: ["只读模型目录", "GET /v1/models", "route fixture", "假模型清单", "不会联系外网", "小尺寸图片", "401", "404", "请求 ID", "脱敏"],
      screenshot: shot(4, "常见错误与请求排查文档中的客户端连通检查"),
    },
  },
};
