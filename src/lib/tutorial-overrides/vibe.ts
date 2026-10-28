import type { TutorialOverride } from "./types";

const screenshot = (step: number, alt: string, caption: string) => ({
  src: `/tutorials/vibe/step-${String(step).padStart(2, "0")}.png`,
  alt,
  caption,
  width: 1440,
  height: 1000,
});

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一张可用作风格参考的 PNG、JPG 或 WebP 图片。练习时可选择支持 Vibe 的 NovelAI 图像模型；也可先读完教程，稍后再上传。",
  summary: "选择支持 Vibe 的模型，添加风格参考，调节强度与信息提取，再查看生成结果。",
  steps: {
    0: {
      title: "选择支持 Vibe 的图像模型",
      body: "在模型设置中选择支持 Vibe 的 NovelAI 图像模型。Vibe 模式只会在支持的模型下可用；手机请先打开「参数」确认当前图像模型。",
      tip: "使用 NovelAI V4 或 V5 图像模型。若没有看到「风格迁移」区域，请检查模型来源和工作区布局。",
      keywords: ["支持 Vibe", "NovelAI", "参数"],
      target: '[aria-label="模型"], [data-layout-module="model"], .replica-model-controls, .mobile-studio-mode-selector, button[aria-label="打开生成参数"]',
      screenshot: screenshot(1, "图像工作台中用于选择 Vibe 兼容模型的模型设置区域", "实际工作台截图：先选择支持 Vibe 的 NovelAI 图像模型。"),
    },
    1: {
      title: "添加一张 Vibe 风格参考",
      body: "在画布上方打开「当前：…」生成模式并选择 Vibe，再到「参考图片」区域选择「氛围迁移」并导入图片。也可从图片库选择已保存的参考图。手机请在「生成模式」中选 Vibe，再从参数里的「参考图片」上传；说明挡住控件时，先点「收起说明，继续操作」。",
      tip: "确认缩略图出现在参考图片区域。Vibe 图片是风格参考，不会作为图生图源图。建议先用一张清晰的参考图。",
      keywords: ["生成模式", "Vibe", "参考图片", "图片库", "风格参考"],
      area: "mode",
      target: 'button[aria-label="生成模式"], .mobile-studio-mode-selector, [data-tutorial="vibe"], [data-layout-module="references"], .mobile-studio-reference-panel, .reference-parameter-card',
      screenshot: screenshot(2, "图像工作台中已选择 Vibe 模式并载入风格参考图片", "实际工作台截图：选择 Vibe 并添加一张风格参考。"),
    },
    2: {
      title: "调节参考强度与信息提取",
      body: "参考图载入后会显示两个滑杆。「参考强度」控制参考风格影响画面的程度；「信息提取」控制从参考图提取的信息量。先保留默认值，之后每次只调整一个，方便比较变化。",
      tip: "参考强度默认 0.6，信息提取默认 1。较低的参考强度通常更适合先观察提示词本身的效果。",
      keywords: ["参考强度", "信息提取", "默认值"],
      area: "sampling",
      target: '.reference-parameter-card, [data-tutorial="vibe"] .replica-slider-label, [data-tutorial="vibe"], .mobile-studio-reference-panel',
      screenshot: screenshot(3, "风格迁移区域中已载入参考图并显示参考强度和信息提取滑杆", "实际工作台截图：调整参考强度与信息提取。"),
    },
    3: {
      title: "描述新的画面",
      body: "在提示词中描述这次要画的主体、动作和构图，再写希望借鉴的色彩、光线或笔触。Vibe 主要传递参考图的视觉风格；新画面内容仍由提示词和模型共同决定。",
      tip: "不需要照抄参考图的人物、姿势或场景。手机可通过底部「提示词」打开编辑区。",
      keywords: ["主体", "构图", "视觉风格", "提示词"],
      target: '[data-tutorial="prompt"], [data-layout-module="prompt"], .replica-prompt, .mobile-studio-prompt-content',
      screenshot: screenshot(4, "图像工作台提示词编辑区域，用于描述新画面的主体和构图", "实际工作台截图：描述新画面，并补充要借鉴的风格特征。"),
    },
    4: {
      title: "核对设置并决定是否生成",
      body: "提交前检查模型、提示词、参考图、参考强度和信息提取。只有在你主动点击「生成」时才会开始任务；学习教程时可以跳过提交，直接阅读结果步骤。",
      tip: "实际生成可能消耗当前图像来源的额度。教程不会替你提交。",
      keywords: ["参考强度", "信息提取", "生成"],
      target: '[data-layout-module="generate"], [data-studio-generate], .mobile-studio-footer button[data-studio-generate]',
      screenshot: screenshot(5, "图像工作台生成按钮和已准备好的 Vibe 参数", "实际工作台截图：确认设置后，由你决定是否提交。"),
    },
    5: {
      title: "查看、比较并保存结果",
      body: "生成完成后，结果会显示在画布或预览区。查看画面是否采用了期望的风格，同时确认主体和构图符合提示词；满意后使用结果菜单下载。若想微调，可返回提示词或参考参数再试。",
      tip: "没有生成结果时，先记住预览区的位置；之后可从历史打开已完成的图片。",
      keywords: ["结果", "预览区", "下载", "历史"],
      target: '.mobile-studio-preview-section, .replica-media, [data-layout-module="canvas"]',
      screenshot: screenshot(6, "工作台预览区域显示由本地 UI 审计图片夹具返回的结果", "实际工作台截图：查看结果并使用下载菜单保存。"),
    },
  },
};
