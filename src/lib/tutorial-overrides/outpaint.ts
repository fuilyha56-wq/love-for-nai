import type { TutorialOverride } from "./types";

const shot = (step: number, alt: string) => ({
  src: `/tutorials/outpaint/step-${String(step).padStart(2, "0")}.png`,
  alt,
  width: 1440,
  height: 1000,
  caption: "本地运行的 Love for NAI 实际操作界面截图",
});

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一张本机 PNG、JPG 或 WebP 图片，并登录账号。教程只会在本地练习；扩图生成可能产生费用，练习时可以跳过生成。",
  summary: "上传源图，进入无限画布，扩展生成框并检查扩图结果。",
  steps: {
    0: {
      title: "选择重绘模式并上传源图",
      body: "在画布上方点击「当前：…」，选择「局部重绘」模式，然后在源图片区域上传本机 PNG、JPG 或 WebP。确认源图缩略图出现后再继续；已有图片也可直接作为源图。",
      tip: "此步骤只选择模式和源图，不会提交生成。",
      area: "mode",
      keywords: ["局部重绘", "上传图片", "源图片", "源图"],
      screenshot: shot(1, "图像工作台显示已上传的扩图源图片"),
    },
    1: {
      title: "打开无限画布",
      body: "图片已就绪后，桌面端点击源图操作中的「无限画布」按钮，直接进入无限画布。手机端点击「绘制重绘蒙版」打开编辑器，再点顶部的「无限画布」切换模式。",
      tip: "若源图尚未上传，先点击高亮的源图片区域上传；源图就绪后目标会改为「无限画布」按钮。手机端入口是「绘制重绘蒙版」，进入编辑器后需切换到「无限画布」。",
      area: "source",
      target: '[data-tutorial="source"], .mobile-studio-reference-panel, button[data-tutorial-editor="canvas"]',
      keywords: ["无限画布", "图像编辑器"],
      screenshot: shot(2, "工作台高亮源图操作中的无限画布入口"),
    },
    2: {
      title: "把生成框移到画面外",
      body: "手机端先在编辑器顶部点「无限画布」；桌面端入口已直接打开该模式。在画布上拖动生成框的角点，让框越过原图边缘，并在框内留出新增区域。框内应保留一部分原图，供模型衔接背景。源图会继续保留在画布中。",
      tip: "拖动生成框的角点调整范围；拖动框内区域可移动取景。",
      area: "editor-canvas",
      target: ".editor-stage",
      keywords: ["生成框", "扩图", "画布"],
      screenshot: shot(3, "无限画布编辑器保留源图并显示越过原图边缘的生成框"),
    },
    3: {
      title: "描述要补出的画面",
      body: "打开编辑器的生成参数，写出新增区域的内容，并说明要延续的光线、透视和画风。检查生成框覆盖范围、输出尺寸、模型和费用。",
      tip: "例如：向右延伸花园与石径，延续原图的柔和日光和透视。",
      area: "editor-params",
      keywords: ["提示词", "输出尺寸", "费用"],
      screenshot: shot(4, "无限画布编辑器的扩图提示词和输出参数"),
    },
    4: {
      title: "生成并检查接缝",
      body: "准备好后，亲自点击「生成并预览」运行扩图。等待候选结果出现，拖动比较分隔线检查新增区域与原图边缘；不满意时可以重新生成或丢弃。",
      tip: "提交扩图会按当前来源和模型计费。只想了解流程时，可以跳过生成并继续阅读。",
      area: "editor-actions",
      keywords: ["生成并预览", "比较", "接缝"],
      screenshot: shot(5, "本地编辑器显示已生成的扩图候选与比较控件"),
    },
    5: {
      title: "应用或下载扩图",
      body: "满意时点击「应用到工作台」将结果写回工作台；也可以下载合成图。要继续扩展另一侧，移动生成框后再分次完成。最后点击「完成教程，返回教程中心」。",
      tip: "只有应用操作会更新工作台中的当前图片。",
      area: "editor-actions",
      keywords: ["应用到工作台", "下载合成图", "返回教程中心"],
      screenshot: shot(6, "完成扩图练习后返回个人资料的功能教程中心"),
    },
  },
};
