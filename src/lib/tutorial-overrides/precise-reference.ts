import type { TutorialOverride } from "./types";

const screenshot = (step: number, alt: string, caption: string) => ({
  src: `/tutorials/precise-reference/step-${String(step).padStart(2, "0")}.png`,
  alt,
  caption,
  width: 1440,
  height: 1000,
});

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一张清晰的 PNG、JPG 或 WebP 参考图，并选择支持精准参考的图像模型。教程只在本机操作，不会提交生成。",
  summary: "切换到精准参考，添加图片并选择人物、风格或两者，再写本次动作与场景并检查设置。",
  steps: {
    0: {
      title: "选择支持参考图的模型",
      body: "在工作台的模型菜单选择支持图像编辑和精准参考的模型。桌面可在参数栏选择模型；手机先打开「参数」，再选择「图像模型」。",
      tip: "如果精准参考模式不可用，请先换成支持参考图的模型。",
      area: "model",
      target: '.replica-model-controls [aria-label="模型"], [data-layout-module="model"] [aria-label="模型"], [aria-label="模型"], button[aria-label="打开生成参数"]',
      keywords: ["模型菜单", "图像编辑", "精准参考", "参数", "图像模型"],
      screenshot: screenshot(1, "本机图像工作台中模型选择控件的实际截图", "实际工作台截图 · 选择支持精准参考的模型"),
    },
    1: {
      title: "切换到精准参考模式",
      body: "打开工作台顶部「当前：…」生成模式菜单，选择「精准参考」。手机在画布的「生成模式」菜单中选择同一模式。",
      tip: "确认顶部模式显示为精准参考，再继续添加参考图。",
      area: "mode",
      target: 'button[aria-label*="点击选择生成模式"], button[aria-label="生成模式"], .mobile-studio-mode-selector button',
      keywords: ["当前：…", "生成模式", "精准参考"],
      screenshot: screenshot(2, "本机图像工作台中精准参考生成模式入口的实际截图", "实际工作台截图 · 选择精准参考模式"),
    },
    2: {
      title: "添加一张精准参考图",
      body: "在「精准参考」区域点击「添加参考图」，从本机选择一张清晰图片。看到图片缩略图后再继续；也可以使用「从库导入」选择已有图片。",
      tip: "这张图片会作为精准参考输入，不是图生图源图或 Vibe 风格参考。",
      area: "reference",
      target: '.replica-section[data-tutorial="precise"] .replica-tonal-button, .mobile-studio-reference-panel .mobile-reference-action.is-primary',
      keywords: ["精准参考", "添加参考图", "缩略图", "从库导入", "图生图源图", "Vibe"],
      screenshot: screenshot(3, "本机工作台精准参考区域中已载入参考图片的实际截图", "实际工作台截图 · 添加参考图片"),
    },
    3: {
      title: "选择要保留的参考类型",
      body: "在「精准参考类型」中选择「角色」「风格」或「角色与风格」。人物外观是重点时选角色；借鉴画面呈现时选风格；两者都需要时保留角色与风格。手机先点「参数」打开设置面板，再选择参考类型。",
      tip: "不同模型支持的参考组合可能不同，先用一张参考图观察效果。",
      area: "reference",
      target: '.replica-reference-type .popup-select-trigger, [aria-label="精准参考类型"], .mobile-studio-reference-panel .mobile-reference-action.is-primary, button[aria-label="打开生成参数"]',
      keywords: ["精准参考类型", "角色", "风格", "角色与风格", "一张参考图", "参数"],
      screenshot: screenshot(4, "本机工作台中精准参考类型选择控件的实际截图", "实际工作台截图 · 选择人物或风格参考"),
    },
    4: {
      title: "描述新的动作与场景",
      body: "在主提示词写这次要生成的动作、场景和镜头，例如「人物在花园中回头，午后阳光，半身构图」。参考图提供要保留的人物或风格信息，提示词描述新的画面内容。",
      tip: "先保持描述简洁，并检查参考图和提示词说的是同一目标。",
      area: "prompt",
      target: '.replica-prompt textarea, [data-tutorial="prompt"] textarea, .mobile-studio-prompt-content textarea',
      keywords: ["主提示词", "动作", "场景", "镜头", "人物", "风格", "新的画面内容"],
      screenshot: screenshot(5, "本机工作台中提示词输入框的实际截图", "实际工作台截图 · 补充目标动作与场景"),
    },
    5: {
      title: "检查设置并完成教程",
      body: "检查模型、精准参考模式、参考图片、参考类型和提示词。实际生成前请你自行确认尺寸、张数与费用，再亲自点击「生成」；本教程不会提交生成。点「完成教程，返回教程中心」即可回到教程列表。",
      tip: "也可以随时点「退出教程，返回个人资料的教程中心」；退出和完成都会回到个人资料的教程中心。",
      area: "generate",
      target: '.replica-run-button, [data-studio-generate], .mobile-studio-footer button[data-studio-generate], .nai-generate-button',
      keywords: ["模型", "精准参考模式", "参考图片", "参考类型", "提示词", "尺寸", "张数", "费用", "生成", "完成教程，返回教程中心", "退出教程", "个人资料的教程中心"],
      screenshot: screenshot(6, "本机工作台中已填写的精准参考设置和生成按钮实际截图", "实际工作台截图 · 检查设置并返回教程中心"),
    },
  },
};
