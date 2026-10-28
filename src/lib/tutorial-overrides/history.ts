import type { TutorialOverride } from "./types";

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一条本地测试历史记录。教程审计使用本地 fixture，不会提交生成、下载记录或分享作品。",
  summary: "从个人图片历史查看作品与参数，下载图片，再将参数导入工作台继续编辑。",
  steps: {
    0: {
      title: "打开个人图片历史",
      body: "在历史列表中查看生成图片与提示词。可以通过页面搜索或筛选找到作品；本机保存的记录与服务端历史范围可能不同。",
      tip: "图片历史列表中的缩略图可打开预览，完整请求参数入口可查看记录详情。",
      target: ".history-grid .history-image-button",
      keywords: ["历史列表", "生成图片", "提示词", "搜索", "筛选", "本机", "服务端", "缩略图", "预览", "完整请求参数"],
      screenshot: { src: "/tutorials/history/desktop-step-01.png", alt: "图片历史列表显示本地审计夹具图片与提示词", width: 1440, height: 1000, caption: "实际页面截图 · 打开个人图片历史" },
    },
    1: {
      title: "查看详情与下载",
      body: "使用记录上的下载菜单保存图片，也可以打开完整请求参数查看提示词与生成设置。下载菜单可选择原图，或移除 NAI 数据后再下载。",
      tip: "下载会保存到你的设备；移除 NAI 数据会清理图片元数据。",
      target: '.image-download-menu summary[aria-label="下载图片"], .launcher-history-download, .history-detail-download',
      keywords: ["下载菜单", "保存图片", "完整请求参数", "提示词", "生成设置", "原图", "移除 NAI 数据", "设备", "图片元数据"],
      screenshot: { src: "/tutorials/history/desktop-step-02.png", alt: "图片历史中的下载菜单及原图和移除 NAI 数据选项", width: 1440, height: 1000, caption: "实际页面截图 · 查看详情与下载" },
    },
    2: {
      title: "复用参数或继续编辑",
      body: "从历史记录选择「导入为图生图」或「复用生成参数」，把作品带回工作台。也可以从详情返回工作台；导入后先核对模型、提示词和尺寸。",
      tip: "图生图会带入历史图片作为源图；复用参数会先载入设置，生成前仍需你检查并提交。",
      target: '.history-grid .history-import-group a, .history-grid .history-card button[aria-label*="历史图片操作"], .history-detail-download',
      keywords: ["导入为图生图", "复用生成参数", "工作台", "历史图片", "源图", "模型", "提示词", "尺寸", "检查并提交"],
      screenshot: { src: "/tutorials/history/desktop-step-03.png", alt: "图片历史中的导入为图生图控件", width: 1440, height: 1000, caption: "实际页面截图 · 复用参数或继续编辑" },
    },
    3: {
      title: "核对导入结果",
      body: "确认工作台中出现预期的提示词与源图，再检查模型、尺寸和其他生成设置。复用种子有助于比较，但跨模型或服务版本不保证结果完全相同。",
      tip: "确认设置后再决定是否开始新任务。",
      target: '[data-tutorial="prompt"] textarea, [data-layout-module="prompt"] textarea, .mobile-studio-prompt-content textarea',
      keywords: ["工作台", "提示词", "源图", "模型", "尺寸", "生成设置", "种子", "跨模型", "服务版本", "新任务"],
      screenshot: { src: "/tutorials/history/desktop-step-04.png", alt: "图片工作台中已导入的提示词与历史图片", width: 1440, height: 1000, caption: "实际页面截图 · 核对导入结果" },
    },
  },
};
