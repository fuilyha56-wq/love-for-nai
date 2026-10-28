import type { TutorialOverride } from "./types";

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一个已收录的标签关键词，例如 white_hair；教程会使用本地标签数据库和提示词补全，不会保存或提交任何内容。",
  summary: "从本地标签数据库检索条目，核对解释，再在工作台试用标签补全。",
  steps: {
    0: {
      title: "搜索本地标签数据库",
      body: "在标签数据库输入至少两个字符的英文标签或中文关键词，然后提交搜索。结果来自本地已收录数据；无匹配时可换用标签名或中文解释。",
      tip: "本机审计使用 white_hair 查询，搜索只读取本地目录，不请求外部标签站点。",
      target: '.workspace-page input[aria-label="搜索标签数据库"]',
      keywords: ["标签数据库", "至少两个字符", "英文标签", "中文关键词", "本地已收录数据", "white_hair", "只读取本地目录"],
      screenshot: { src: "/tutorials/tag-library/step-01.png", alt: "本机标签数据库搜索框和 white_hair 检索入口的真实界面", width: 1440, height: 1000, caption: "本机实际界面截图 · 搜索标签" },
    },
    1: {
      title: "查看标签含义与来源",
      body: "打开一条匹配记录，先核对标签名、中文解释、分类和完整介绍，再查看它的来源。来源字段能说明数据从哪里来；介绍缺失时页面会明确提示。",
      tip: "标签解释和来源记录用于辅助判断，不代表模型一定会按预期理解该词。",
      target: ".workspace-page article header, .workspace-page article section",
      keywords: ["标签名", "中文解释", "分类", "完整介绍", "来源", "明确提示", "辅助判断"],
      screenshot: { src: "/tutorials/tag-library/step-02.png", alt: "本机标签详情页展示标签名、翻译分类与来源介绍的真实界面", width: 1440, height: 1000, caption: "本机实际界面截图 · 核对标签信息" },
    },
    2: {
      title: "复制或记录需要的标签",
      body: "确认词义后再挑选要复用的标签。手机界面可点「复制标签」；桌面可从详情页选中标签文字复制。只保留符合画面目标的词，避免把相似标签全部堆进提示词。",
      tip: "标签数据库不会自动收藏条目；个人常用内容可在提示词编辑器中整理到自己的词库。",
      target: ".workspace-page article .flex, .workspace-page article header",
      keywords: ["复制标签", "详情页", "选中标签文字", "符合画面目标", "提示词编辑器", "自己的词库"],
      screenshot: { src: "/tutorials/tag-library/step-03.png", alt: "本机标签详情页真实展示可复制的标签信息", width: 1440, height: 1000, caption: "本机实际界面截图 · 选择要复用的标签" },
    },
    3: {
      title: "在工作台试用标签补全",
      body: "在正向提示词中输入标签开头，等待标签建议出现，再核对显示名称、分类和说明。用方向键与 Enter 或 Tab 插入选中项；插入后检查逗号分隔、重复词和最终提示词。",
      tip: "标签建议来自当前本地词库及标签目录；教程只在本机编辑器中输入示例，不会生成图片或写入账户。",
      target: '.tag-suggest-panel[role="listbox"], [role="listbox"][aria-label="标签联想"]',
      keywords: ["正向提示词", "标签开头", "标签建议", "显示名称", "分类", "说明", "方向键", "Enter", "Tab", "逗号分隔", "重复词", "本机编辑器"],
      screenshot: { src: "/tutorials/tag-library/step-04.png", alt: "本机图像工作台提示词补全显示标签建议与说明的真实界面", width: 1440, height: 1000, caption: "本机实际界面截图 · 使用标签补全" },
    },
  },
};
