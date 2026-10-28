import type { TutorialOverride } from "./types";

export const tutorialOverride: TutorialOverride = {
  steps: {
    0: {
      title: "选择图像模型",
      body: "在「模型来源」选择可用来源，再打开「模型」下拉框选择一个图像模型。保持生成模式为「文生图」；手机可在「参数」中的「图像操作」检查，桌面可从画布上方的模式入口检查。",
      target: '.studio-model-controls .popup-select-trigger[aria-label="模型"], .mobile-studio-mode-selector',
      keywords: ["模型来源", "模型", "图像模型", "生成模式", "文生图", "图像操作"],
      screenshot: { src: "/tutorials/text-to-image/step-01.png", alt: "个人资料教程启动后，图片工作台显示模型下拉框的实际界面。", width: 1440, height: 1000, caption: "本机实际操作截图 · 选择图像模型" },
    },
    1: {
      target: '[data-tutorial="prompt"] textarea, [data-layout-module="prompt"] textarea, .mobile-studio-prompt-content textarea',
      keywords: ["提示词", "主体", "动作", "环境", "画风", "负向提示词"],
      screenshot: { src: "/tutorials/text-to-image/step-02.png", alt: "图片工作台提示词输入框的实际界面，输入框被教程高亮。", width: 1440, height: 1000, caption: "本机实际操作截图 · 填写提示词" },
    },
    2: {
      target: '[data-layout-module="image"] .grid-cols-\\[1fr_auto_1fr\\], .replica-image-size [aria-label="图片宽度"], .mobile-studio-sheet-content input[type="number"]',
      keywords: ["图像尺寸", "画幅", "张数", "竖图", "横图", "方图", "交换宽高"],
      screenshot: { src: "/tutorials/text-to-image/step-03.png", alt: "图片工作台宽高输入与画幅选项的实际界面，宽高字段被教程高亮。", width: 1440, height: 1000, caption: "本机实际操作截图 · 设置画幅" },
    },
    3: {
      target: '[data-tutorial="sampling"] input[aria-label="采样步数"], [data-layout-module="sampling"] input[aria-label="采样步数"]',
      keywords: ["步数", "相关性", "采样器", "种子", "默认"],
      screenshot: { src: "/tutorials/text-to-image/step-04.png", alt: "图片工作台生成参数中的采样步数输入框实际界面。", width: 1440, height: 1000, caption: "本机实际操作截图 · 认识生成参数" },
    },
    4: {
      target: '[data-layout-module="generate"] button[data-studio-generate], button[data-studio-generate]',
      keywords: ["模型", "尺寸", "张数", "预计费用", "生成按钮"],
      screenshot: { src: "/tutorials/text-to-image/step-05.png", alt: "图片工作台显示费用与生成按钮的实际界面，生成按钮被教程高亮。", width: 1440, height: 1000, caption: "本机实际操作截图 · 核对费用并提交" },
    },
    5: {
      target: '.workspace-result-download summary, .replica-media .replica-download-menu summary, .mobile-studio-preview-section .image-download-menu summary',
      body: "生成结果出现后，先放大检查主体、细节和画面边缘。点击结果旁的「下载」菜单保存图片；也可以继续图生图、局部重绘或超分。",
      keywords: ["生成结果", "放大", "检查", "下载", "图生图", "局部重绘", "超分"],
      screenshot: { src: "/tutorials/text-to-image/step-06.png", alt: "本地假图接口生成后，工作台展示图片结果与下载菜单的实际界面。", width: 1440, height: 1000, caption: "本机实际操作截图 · 查看并保存结果" },
    },
  },
};
