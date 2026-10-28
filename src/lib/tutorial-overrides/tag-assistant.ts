import type { TutorialOverride } from "./types";

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一张允许用于本机测试的图片。标签助手可以把图片和文字需求一起交给当前可用的助手模型；如果只想本地识图，可在反推面板导入 ONNX tagger 模型。",
  summary: "打开标签助手，附上图片和识别要求，检查返回的标签建议，再决定如何加入提示词。",
  steps: {
    0: {
      title: "打开标签助手",
      body: "在桌面工作台右侧打开「聊天助手」，再选择「标签助手」模式；手机点右上角「助手」打开同一面板。标签助手使用已配置的助手模型，也可以从工作台的图片反推面板进入本地 ONNX tagger。",
      tip: "本地 ONNX 识图需先在设置中导入模型；在线助手是否可用取决于账号模型配置。教程不会自动调用助手。",
      target: '[data-layout-module="agent"] [aria-label="标签助手模式"] button:first-child',
      keywords: ["聊天助手", "标签助手", "助手", "图片反推", "本地 ONNX tagger", "导入模型"],
      screenshot: { src: "/tutorials/tag-assistant/step-01.png", alt: "本机工作台已打开标签助手面板，教程高亮真实可操作的助手区域", width: 1440, height: 1000, caption: "本机实际界面截图 · 打开标签助手" },
    },
    1: {
      title: "添加图片并说明识别目标",
      body: "点击上传图片按钮选择 PNG、JPG 或 WebP，也可把图片粘贴到助手输入框。然后写清要识别的内容，例如「识别人物服装、发色和背景标签」。检查缩略图与文字后再提交。",
      tip: "助手会收到你附加的图片与需求。请只上传你有权使用的图片；教程不会替你选取或上传文件。",
      target: 'label[title="上传图片让助手识图"]',
      keywords: ["上传图片", "粘贴", "PNG", "JPG", "WebP", "人物服装", "发色", "背景标签", "缩略图"],
      screenshot: { src: "/tutorials/tag-assistant/step-02.png", alt: "标签助手中已附加测试图片并填写识别需求，上传控件和输入框可操作", width: 1440, height: 1000, caption: "本机实际界面截图 · 附图并描述识别目标" },
    },
    2: {
      title: "提交识图并检查建议",
      body: "点击「让助手处理」，等待助手完成图片分析。查看建议差异预览中的说明、已校验标签和负向词，移除不符合图片的内容；本地 tagger 还可调整通用标签与角色标签阈值后重试。",
      tip: "在线助手会按当前账号和模型规则计费。审计截图使用本机 route fixture 返回示例建议，真实使用时请先确认模型与费用。",
      target: '[data-layout-module="agent"] button[type="submit"], .assistant-preview',
      keywords: ["让助手处理", "建议差异预览", "已校验标签", "负向词", "通用标签阈值", "角色标签阈值", "本机 route fixture", "费用"],
      screenshot: { src: "/tutorials/tag-assistant/step-03.png", alt: "标签助手已收到本机 fixture 的示例标签建议，结果面板真实呈现", width: 1440, height: 1000, caption: "本机实际界面截图 · 检查识图建议" },
    },
    3: {
      title: "挑选标签并加入提示词",
      body: "确认建议后，可用「追加标签」把校验标签并入现有提示词，或用「替换提示词」采用完整建议；也可以先修改提示词框，只保留需要的内容。完成或中途退出教程都会返回 /profile#profile-tutorials。",
      tip: "审计会验证追加操作只更新本机工作台提示词，并验证完成和退出都回到个人资料的教程中心。",
      target: '.assistant-preview .assistant-actions',
      area: "assistant",
      keywords: ["追加标签", "替换提示词", "修改提示词", "本机工作台", "完成教程", "退出教程", "/profile#profile-tutorials"],
      screenshot: { src: "/tutorials/tag-assistant/step-04.png", alt: "本机标签建议面板展示追加标签与替换提示词操作", width: 1440, height: 1000, caption: "本机实际界面截图 · 选择并应用标签" },
    },
  },
};
