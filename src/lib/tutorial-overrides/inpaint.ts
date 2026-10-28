import type { TutorialOverride } from "./types";

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一张可以练习的源图；教程会引导你选择重绘模式、上传图片、绘制蒙版并查看候选结果。",
  summary: "从选择重绘模式开始，上传源图，在蒙版中指定修改范围，再比较并应用候选结果。",
  steps: {
    0: {
      target: ".studio-mode-picker, .mobile-studio-mode-selector",
      tip: "如果列表里没有「局部重绘」，先切换到支持重绘的模型，再回到这里选择模式。",
      keywords: ["当前模式", "局部重绘", "重绘模式"],
      screenshot: { src: "/tutorials/inpaint/step-01.png", alt: "图片工作台中的局部重绘模式选择入口", width: 1440, height: 1000, caption: "本地实际界面截图；演示数据与源图仅用于教程。" },
    },
    1: {
      target: '[data-tutorial="inpaint-source"], [data-tutorial-editor="inpaint"]',
      body: "先在「上传重绘源图片」中选择本机 PNG、JPG 或 WebP。确认源图缩略图出现后，再点击高亮的编辑器入口（如「独立重绘编辑器」或「绘制蒙版与精确重绘」）进入编辑器。",
      tip: "本步骤会停留在工作台，直到源图已就绪；教程不会替你选择或上传文件。",
      keywords: ["上传重绘源图片", "独立重绘编辑器", "绘制蒙版与精确重绘", "源图缩略图"],
      screenshot: { src: "/tutorials/inpaint/step-02.png", alt: "源图已上传并高亮局部重绘编辑器入口", width: 1440, height: 1000, caption: "本地实际界面截图；演示数据与源图仅用于教程。" },
    },
    2: {
      target: ".editor-left-panel, .editor-mobile-sheet-body",
      tip: "白色表示要重绘，黑色表示保留；先选择「绘制」再在画布上拖动。使用「擦除」修正涂错的区域。",
      keywords: ["绘制", "擦除", "蒙版", "白色编辑", "黑色保护"],
      screenshot: { src: "/tutorials/inpaint/step-03.png", alt: "局部重绘编辑器中的蒙版绘制工具和源图画布", width: 1440, height: 1000, caption: "本地实际界面截图；演示数据与源图仅用于教程。" },
    },
    3: {
      target: '[data-tutorial="editor-params"], .editor-mobile-sheet-body',
      tip: "生成框至少覆盖蒙版和少量周边环境；提示词描述修改后的目标，模型与强度按需要调整。",
      keywords: ["生成框", "提示词", "变化强度", "生成参数"],
      screenshot: { src: "/tutorials/inpaint/step-04.png", alt: "编辑器中的生成范围与重绘参数", width: 1440, height: 1000, caption: "本地实际界面截图；演示数据与源图仅用于教程。" },
    },
    4: {
      target: ".editor-actions",
      tip: "确认费用后亲自点击「生成并预览」；教程不会代你提交重绘。",
      keywords: ["生成并预览", "费用", "候选结果"],
      screenshot: { src: "/tutorials/inpaint/step-05.png", alt: "生成候选结果前的编辑器操作按钮", width: 1440, height: 1000, caption: "本地实际界面截图；演示数据与源图仅用于教程。" },
    },
    5: {
      target: ".editor-actions",
      tip: "应用会把合成图带回工作台；也可以下载候选图、重新生成或丢弃。",
      keywords: ["应用到工作台", "比较", "下载", "丢弃"],
      screenshot: { src: "/tutorials/inpaint/step-06.png", alt: "候选重绘结果已生成，可比较并应用到工作台", width: 1440, height: 1000, caption: "本地实际界面截图；演示数据与源图仅用于教程。" },
    },
  },
};
