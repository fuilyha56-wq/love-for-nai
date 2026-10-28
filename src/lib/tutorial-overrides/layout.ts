import type { TutorialOverride } from "./types";

const screenshot = (step: number, alt: string, caption: string) => ({
  src: `/tutorials/layout/desktop-step-${String(step).padStart(2, "0")}.png`,
  alt,
  width: 1440,
  height: 1000,
  caption,
});

export const tutorialOverride: TutorialOverride = {
  preparation: "主题、强调色和自定义工作台布局保存在当前浏览器。教程只会改本机偏好，不会修改账号或作品数据。",
  summary: "选择界面主题，打开布局编辑器，调整模块并保存到当前浏览器。",
  steps: {
    0: {
      title: "选择界面主题",
      body: "在主题选项中选择宣纸、暮色、夜间或 NAI 风格。强调色、内容密度和动效也在外观设置中调整；这些偏好只应用于当前浏览器。",
      tip: "布局和外观偏好保存在本机浏览器。",
      path: "/settings#appearance",
      target: "article.panel button[aria-pressed='true']",
      keywords: ["主题", "强调色", "内容密度", "动效", "当前浏览器"],
      screenshot: screenshot(1, "外观设置中选中的主题选项，教程高亮实际主题按钮", "本机实际操作截图 · 选择主题"),
    },
    1: {
      title: "打开布局编辑器",
      body: "在「自定义布局」区域打开独立布局编辑器。这里可以预览左右侧栏与固定画布，并选择模块卡片查看属性。",
      tip: "进入编辑器不会立即应用未保存的修改。",
      path: "/settings#appearance",
      target: 'a[href="/image/setting/layout"]',
      keywords: ["自定义布局", "独立布局编辑器", "固定画布", "未保存"],
      screenshot: screenshot(2, "外观设置中的独立布局编辑器入口，教程高亮实际链接", "本机实际操作截图 · 打开布局编辑器"),
    },
    2: {
      title: "调整模块顺序与属性",
      body: "在预览中选中模块，使用卡片把手拖动排序，也可用方向键移动；右侧属性区可切换显隐、调整卡片宽度与高度。画布和生成按钮固定。",
      tip: "先尝试移动一张卡片或调整显示状态；修改保存前只保留在编辑器中。",
      path: "/image/setting/layout",
      target: '[data-layout-module="image"] .layout-drag-handle',
      keywords: ["模块", "拖动排序", "方向键", "显隐", "卡片宽度", "固定"],
      screenshot: screenshot(3, "布局编辑器预览中图像尺寸模块的排序把手，教程高亮真实控件", "本机实际操作截图 · 调整模块"),
    },
    3: {
      title: "保存并检查布局",
      body: "点击「保存布局」将模块编排写入当前浏览器，并设为工作台布局。随后打开图片工作台，检查左右栏是否符合你的工作流。",
      tip: "教程结束或中途退出都会返回个人资料的教程中心。",
      path: "/image/setting/layout",
      target: ".layout-editor-bottom button",
      keywords: ["保存布局", "当前浏览器", "图片工作台", "工作流"],
      screenshot: screenshot(4, "布局编辑器底部的保存布局按钮，教程高亮实际保存控件", "本机实际操作截图 · 保存布局"),
    },
  },
};
