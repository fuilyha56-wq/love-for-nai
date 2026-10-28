import type { TutorialOverride } from "./types";

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一张本机 PNG、JPG 或 WebP 图片，并确认当前图像模型支持图生图。教程会使用本机测试图片验证操作；真实生成前请先核对当前来源与预计费用。",
  summary: "选择图生图模式，导入本机源图，描述希望保留和改变的部分，再调整变化强度并检查结果。",
  steps: {
    0: {
      title: "选择图生图模式",
      body: "在画布上方打开「当前：…」生成模式，选择「图生图」。手机点击画布里的「生成模式」。如果选项不可用，先在模型参数中选择支持图生图的图像模型，再回来切换。",
      tip: "图生图会把源图作为视觉参考；当前模型和来源决定可用模式、参数与费用。",
      target: ".studio-mode-picker, .mobile-studio-mode-selector",
      keywords: ["当前：…", "生成模式", "图生图", "源图", "图像模型", "参数", "费用"],
      screenshot: { src: "/tutorials/image-to-image/step-01.png", alt: "图片工作台中打开图生图模式的实际界面", width: 1440, height: 1000, caption: "本机实际操作截图 · 选择图生图模式" },
    },
    1: {
      title: "导入本机源图",
      body: "在「图生图」区域点击上传图片，从本机选择 PNG、JPG 或 WebP。等源图缩略图出现后再继续；也可以从已有结果或历史记录选择「用于图生图」。",
      tip: "图片只在此本地测试浏览器中使用。教程不会自动选择文件或将图片上传到外部服务器。",
      target: '[data-tutorial="source"], .mobile-studio-reference-panel',
      keywords: ["图生图", "源图", "上传图片", "本机", "缩略图", "用于图生图"],
      screenshot: { src: "/tutorials/image-to-image/step-02.png", alt: "图片工作台图生图源图上传区域的实际界面", width: 1440, height: 1000, caption: "本机实际操作截图 · 导入源图" },
    },
    2: {
      title: "描述保留与修改内容",
      body: "在提示词中先写希望保留的主体和构图，再说明要改变的服装、背景或画风。例如：保留蓝发人物与姿势，改成白色连衣裙和花园阳光。源图提供视觉信息，提示词说明本次目标。",
      tip: "一次只提出清楚的改动，便于判断源图与提示词分别产生的影响。",
      target: '[data-tutorial="prompt"] textarea, [data-layout-module="prompt"] textarea, .mobile-studio-prompt-content textarea',
      keywords: ["提示词", "保留", "主体", "构图", "改变", "服装", "背景", "画风", "源图"],
      screenshot: { src: "/tutorials/image-to-image/step-03.png", alt: "图片工作台中图生图提示词输入区的实际界面", width: 1440, height: 1000, caption: "本机实际操作截图 · 描述保留与修改内容" },
    },
    3: {
      title: "调整变化强度",
      body: "找到「变化强度」滑块。较低强度通常更贴近源图，较高强度允许更明显的变化；可以从中低值开始，再逐步调整。手机会打开「参数」面板。输出尺寸尽量保持与源图相近的长宽比例。",
      tip: "强度的实际效果会随模型、提示词和源图变化；请以当前模型说明与结果为准。",
      area: "size",
      target: '[data-layout-module="operations"] input[type="range"], .replica-slider-label input[aria-label="变化强度"], .mobile-parameter-panel .studio-operation-settings input[type="range"]',
      keywords: ["变化强度", "较低强度", "源图", "较高强度", "输出尺寸", "长宽比例", "模型"],
      screenshot: { src: "/tutorials/image-to-image/step-04.png", alt: "图生图变化强度滑块的实际界面", width: 1440, height: 1000, caption: "本机实际操作截图 · 调整变化强度" },
    },
    4: {
      title: "核对参数并提交",
      body: "检查所选模型、输出尺寸、张数与预计费用，再亲自点击生成按钮。等待任务完成后查看结果；本教程审计时由本地 fixture 拦截请求，不会访问生成服务。",
      tip: "真实任务可能按来源收费；提交前请确认来源与费用。只想学习时也可以直接进入下一步。",
      target: '[data-layout-module="generate"] button[data-studio-generate], button[data-studio-generate]',
      keywords: ["模型", "输出尺寸", "张数", "预计费用", "生成按钮", "本地 fixture", "来源收费"],
      screenshot: { src: "/tutorials/image-to-image/step-05.png", alt: "图生图生成按钮与预计费用的实际界面", width: 1440, height: 1000, caption: "本机实际操作截图 · 核对参数并提交" },
    },
    5: {
      title: "检查并保存结果",
      body: "生成完成后放大检查人物、构图、细节和画面边缘，确认保留内容与修改目标是否符合预期。点击结果旁的「下载」菜单保存图片；需要继续调整时可将结果再次用于图生图。",
      tip: "若结果偏离源图，降低变化强度或缩小提示词改动后再试；再次生成前重新核对费用。",
      target: '.workspace-result-download summary, .replica-media .replica-download-menu summary, .mobile-studio-preview-section .image-download-menu summary',
      keywords: ["生成完成", "放大检查", "人物", "构图", "画面边缘", "下载", "用于图生图", "变化强度", "费用"],
      screenshot: { src: "/tutorials/image-to-image/step-06.png", alt: "图生图结果和下载菜单的实际界面", width: 1440, height: 1000, caption: "本机实际操作截图 · 检查并保存结果" },
    },
  },
};
