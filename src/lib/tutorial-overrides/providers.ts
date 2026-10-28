import type { TutorialOverride } from "./types";

const screenshot = (step: number, alt: string, caption: string) => ({
  src: `/tutorials/providers/step-${String(step).padStart(2, "0")}.png`,
  alt,
  caption,
  width: 1440,
  height: 1000,
});

export const tutorialOverride: TutorialOverride = {
  preparation: "准备自有 OpenAI 兼容图像 API 的地址、模型 ID 和 Key，或 NovelAI 官方 Key。审计用明显虚构的本地夹具值演示，不会连接上游。",
  summary: "在设置中导入自有图像 API 或 NovelAI 官方 Key，检查保存状态，再回到工作台切换来源。",
  steps: {
    0: {
      title: "打开图像来源设置",
      body: "从个人资料教程中心打开「模型与密钥」，定位到「管理模型来源」。这里可添加 OpenAI 兼容图像 API，也可导入 NovelAI 官方 Key；故事模型来源与图像来源分开管理。",
      tip: "导入的 Key 会保存在服务端，保存后不会再次显示。不要把真实 Key 放进截图、提示词或共享内容。",
      target: "#custom-providers h2",
      keywords: ["模型与密钥", "管理模型来源", "OpenAI 兼容图像 API", "NovelAI 官方 Key", "保存在服务端", "不会再次显示"],
      screenshot: screenshot(1, "设置中的模型与密钥及自定义图像来源入口", "本机实际界面截图 · 打开图像来源设置"),
    },
    1: {
      title: "填写连接信息",
      body: "添加 OpenAI 兼容图像 API 时填写便于识别的名称、完整 API 地址、协议、Key 和至少一个模型 ID。导入 NovelAI 时，在下方「导入 NovelAI key」区域粘贴官方 Key；本站不会索取账号密码。",
      tip: "地址只填写服务商提供的根地址，不要重复拼接路径。真实 Key 只在可信设备输入；保存后页面会清空密钥框。",
      target: "#custom-providers form label:has(input[type='url'])",
      keywords: ["名称", "API 地址", "协议", "Key", "模型 ID", "NovelAI key", "不会索取账号密码"],
      screenshot: screenshot(2, "自定义图像来源表单中的名称、地址、协议、Key 与模型 ID 字段", "本机实际界面截图 · 填写连接信息"),
    },
    2: {
      title: "保存并检查来源",
      body: "点击「保存接口」后，确认列表显示已保存的来源和模型。NovelAI Key 则点「验证并导入」，检查订阅等级、状态、Anlas 与有效期；如果账号信息暂时无法读取，可先确认 Key 已保存后再刷新。",
      tip: "本教程不替你验证或调用真实上游。第三方来源的费用、限额与 Key 权限以对应服务商为准。",
      target: "#custom-providers > div.mt-5.space-y-3 > div.rounded-md",
      keywords: ["保存接口", "已保存的来源", "模型", "验证并导入", "订阅等级", "Anlas", "有效期", "服务商"],
      screenshot: screenshot(3, "保存的自定义 API 来源和 NovelAI 官方账号订阅信息", "本机实际界面截图 · 检查保存状态"),
    },
    3: {
      title: "在工作台切换来源",
      body: "回到图片工作台，在「模型来源」中选择刚添加的图像 API 或 NovelAI 官方 Key，再选该来源提供的模型。先核对模型支持的模式和参数；生成操作由你决定。",
      tip: "自带来源的生成请求会发送给你配置的服务商并可能产生费用。本教程只演示选择来源，不会提交生成。",
      target: "[aria-label='模型来源']",
      keywords: ["图片工作台", "模型来源", "图像 API", "NovelAI 官方 Key", "模型", "支持的模式和参数", "不会提交生成"],
      screenshot: screenshot(4, "工作台模型来源选择器展示已导入的自定义 API", "本机实际界面截图 · 在工作台切换来源"),
    },
  },
};
