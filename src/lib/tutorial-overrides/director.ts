import type { TutorialOverride } from "./types";

const screenshot = (step: number, alt: string, caption: string) => ({
  src: `/tutorials/director/step-${String(step).padStart(2, "0")}.png`,
  alt,
  caption,
  width: 1440,
  height: 1000,
});

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一张本机图片，并使用支持所选导演工具的图像来源。操作练习使用移除背景、提取线稿、草图化、线稿上色与情感迁移等入口。",
  summary: "选择导演工具、载入源图，按工具填写提示词或选项，再检查并保存处理结果。",
  steps: {
    0: {
      title: "选择支持编辑的图像模型",
      body: "在模型设置中选择支持图像编辑和导演工具的模型。手机先打开「参数」确认模型；桌面检查画布上方的模型来源与模型名称。",
      tip: "不同来源支持的工具可能不同。若选择工具时显示能力不足，请换用支持该操作的来源。",
      area: "model",
      target: '[aria-label="模型"], .studio-model-controls .popup-select-trigger, .replica-model-controls, .mobile-studio-mode-selector, button[aria-label="打开生成参数"]',
      keywords: ["模型设置", "图像编辑", "导演工具", "参数", "图像来源"],
      screenshot: screenshot(1, "Love for NAI 图像工作台中的模型设置和图像来源实际界面", "本机界面截图 · 确认模型与来源"),
    },
    1: {
      title: "选择导演工具",
      body: "在「导演工具」区域点击一个实际操作按钮：例如「移除背景」「提取线稿」「草图化」「线稿上色」或「情感迁移」。本教程用「线稿上色」演示，其他工具沿用相同的源图与结果流程。",
      tip: "桌面可在图像工具区选择；手机先打开工作台的参数或工具面板，再点对应的导演工具按钮。",
      area: "mode",
      target: '.nai-director-grid .nai-director-button, .custom-image-tools button, [data-layout-module="director"] .panel-section-head, .mobile-studio-mode-selector [aria-label="生成模式"], .mobile-studio-reference-panel button',
      keywords: ["导演工具", "移除背景", "提取线稿", "草图化", "线稿上色", "情感迁移", "图像工具"],
      screenshot: screenshot(2, "图像工作台中移除背景、提取线稿、草图化、线稿上色和情感迁移工具按钮", "本机界面截图 · 选择要执行的导演工具"),
    },
    2: {
      title: "上传一张源图片",
      body: "在源图片区域点击上传，选择 PNG、JPG 或 WebP。确认缩略图载入后继续；导演工具会处理这张源图。",
      tip: "也可以从已有结果或历史图片选择「用于导演工具」。本教程不会自动上传或替换图片。",
      area: "source",
      target: '[data-tutorial="source"] label, [data-layout-module="operations"] input[type="file"], .mobile-studio-reference-panel button, button[aria-label*="上传"]',
      keywords: ["源图片", "上传", "PNG", "JPG", "WebP", "源图", "历史图片"],
      screenshot: screenshot(3, "图像工作台的源图片上传控件以及已载入的练习源图", "本机界面截图 · 导入源图"),
    },
    3: {
      title: "生成候选结果",
      body: "确认源图和工具专用选项。使用「线稿上色」或「情感迁移」时，先在提示词中描述目标颜色或情绪；再点击生成按钮开始处理。",
      tip: "「移除背景」「提取线稿」和「草图化」按界面说明设置。操作练习由本地 route fixture 返回示例结果。",
      area: "generate",
      target: '.replica-run-button, button[data-studio-generate], .nai-generate-button',
      keywords: ["源图", "工具专用选项", "线稿上色", "情感迁移", "目标颜色", "情绪", "生成按钮", "本地 route fixture"],
      screenshot: screenshot(4, "图像工作台中的实际生成按钮，准备运行导演工具", "本机界面截图 · 点击生成处理源图"),
    },
    4: {
      title: "检查处理结果并保存",
      body: "检查处理结果是否符合目标，再使用下载菜单保存图片。也可以回到工具按钮尝试另一种处理。",
      tip: "处理结果会显示在画布或预览区。若边缘、线稿或颜色不理想，可换工具或调整提示词再试。",
      area: "page",
      target: '.workspace-result-download summary, .replica-media-open, .workspace-result-image, .replica-download-menu summary, .image-download-menu summary',
      keywords: ["处理结果", "下载菜单", "画布", "预览区", "生成", "提示词"],
      screenshot: screenshot(5, "图像工作台显示本地 route fixture 返回的导演工具处理结果和保存入口", "本机界面截图 · 检查结果并保存"),
    },
  },
};
