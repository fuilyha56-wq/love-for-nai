const importantTerms = [
  "独立重绘编辑器", "绘制蒙版与精确重绘", "绘制重绘蒙版", "图像编辑器",
  "生成并预览", "应用到工作台", "分块重绘并拼接", "分块超分", "无限画布",
  "模型来源", "生成模式", "图像操作", "图像模型", "生成参数", "正向提示词", "负向提示词",
  "预计费用", "公开范围", "变化强度", "参考强度", "信息提取", "生成框", "上传源图", "上传图片",
  "局部重绘", "精准参考", "人物参考", "风格迁移", "文生图", "图生图", "提示词", "蒙版", "种子",
  "使用记录", "每日签到", "兑换码", "下载菜单", "生成按钮", "角色提示词", "自动位置", "标签助手",
  "故事工作台", "Storyteller", "续写", "改写", "插入", "分支", "故事设置", "个人词库", "标签词库",
  "提示词库", "模型与密钥", "模型 ID", "API 密钥", "NovelAI", "OpenAI", "Key", "Token",
  "布局编辑器", "外观与界面", "保存或应用", "审核状态", "我的投稿", "活动规则", "导入工作台",
];

const escapePatternTerm = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const makeEmphasisPattern = (keywords: string[] = []) => {
  const terms = [...new Set([...importantTerms, ...keywords].filter(Boolean))].sort((a, b) => b.length - a.length).map(escapePatternTerm);
  return new RegExp(`「[^」]+」|${terms.join("|")}`, "g");
};

export function splitTutorialText(value: string, keywords?: string[]): { text: string; important: boolean }[] {
  const parts: { text: string; important: boolean }[] = [];
  const emphasisPattern = makeEmphasisPattern(keywords);
  let start = 0;
  for (const match of value.matchAll(emphasisPattern)) {
    if (match.index > start) parts.push({ text: value.slice(start, match.index), important: false });
    parts.push({ text: match[0], important: true });
    start = match.index + match[0].length;
  }
  if (start < value.length) parts.push({ text: value.slice(start), important: false });
  return parts;
}
