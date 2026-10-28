import type { TutorialOverride } from "./types";

const screenshot = (step: number, alt: string) => ({
  src: `/tutorials/gallery/desktop-step-${String(step).padStart(2, "0")}.png`,
  alt,
  caption: `本机实际界面截图 · 第 ${step} 步`,
  width: 1440,
  height: 1000,
});

export const tutorialOverride: TutorialOverride = {
  preparation: "广场搜索与导入练习使用本地作品夹具和浏览器拦截，不会真实投稿、点赞或调用生成服务。",
  summary: "搜索广场作品、用标签建议缩小结果，再打开作品并导入工作台核对公开参数。",
  steps: {
    0: {
      title: "搜索广场作品",
      body: "在图片广场搜索框输入作品名、作者或标签关键词。列表会按关键词更新；可以先用本地示例作品熟悉搜索，再调整筛选条件。",
      tip: "搜索使用作品公开的标题、作者与标签信息。",
      target: '.workspace-page input[type="search"]',
      keywords: ["图片广场", "搜索框", "作品名", "作者", "标签关键词", "筛选条件"],
      screenshot: screenshot(1, "图片广场本地示例作品和真实搜索框的桌面界面"),
    },
    1: {
      title: "使用标签建议筛选",
      body: "在「按标签筛选作品」输入标签，选择出现的标签建议。标签可与搜索、分级和排序组合；不需要时可重置筛选。",
      tip: "多个标签可以用逗号分隔。",
      target: '.workspace-page [role="combobox"]',
      keywords: ["标签建议", "按标签筛选作品", "搜索", "分级", "排序", "逗号分隔", "重置筛选"],
      screenshot: screenshot(2, "图片广场真实标签筛选控件和已选择的本地示例标签"),
    },
    2: {
      title: "选择作品并导入",
      body: "卡片展示标题、作者、分级和标签；点作品图可打开大图与详情。桌面点击卡片底部的导入按钮；手机先打开作品操作菜单，再选导入到画布。",
      tip: "只有作者公开的参数才能复用；没有结果时，先移除部分关键词或筛选条件。",
      target: '.workspace-page article button:has(svg.lucide-rotate-ccw), .workspace-page article button[aria-label^="作品操作："]',
      keywords: ["卡片", "标题", "作者", "分级", "标签", "作品图", "大图", "详情", "桌面", "导入按钮", "手机", "作品操作菜单", "导入到画布"],
      screenshot: screenshot(3, "图片广场本地示例作品卡片和导入操作的真实桌面界面"),
    },
    3: {
      title: "核对导入参数",
      body: "检查工作台中载入的公开提示词、模型和尺寸，并确认当前模式。图生图会把这件作品带入为源图；核对费用后再决定是否开始新任务。",
      tip: "缺失的参考或不可用模型需要手动补齐，确认设置和费用后再决定是否开始新任务。",
      area: "prompt",
      target: '[data-tutorial="prompt"] textarea, [data-layout-module="prompt"] textarea, .mobile-studio-prompt-content textarea',
      keywords: ["公开提示词", "模型", "尺寸", "当前模式", "图生图", "源图", "费用", "新任务"],
      screenshot: screenshot(4, "图像工作台显示导入的本地公开提示词、参数和源图"),
    },
  },
};
