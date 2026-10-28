import type { TutorialOverride } from "./types";

const image = (step: number, alt: string, caption: string) => ({
  src: `/tutorials/gallery-submit/desktop-step-${String(step).padStart(2, "0")}.png`,
  alt,
  width: 1440,
  height: 1000,
  caption,
});

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一张带有可解析 NAI 参数的 PNG/JPEG，并确认作品可公开分享。投稿前可以填写资料、预览内容；只有你亲自点击「提交审核」才会发送投稿。",
  summary: "从选择作品、填写公开资料到确认投稿与查看审核状态。",
  steps: {
    0: {
      title: "找到投稿入口",
      body: "在图片广场顶部点击「投稿作品」，打开投稿表单。也可以从个人图片历史选择作品后发起投稿。",
      tip: "投稿会进入人工审核；审核通过后才会公开展示。",
      target: ".workspace-page header button",
      keywords: ["图片广场", "投稿作品", "个人图片历史", "人工审核"],
      screenshot: image(1, "图片广场顶部显示投稿作品入口，教程高亮该按钮", "本机实际操作截图 · 打开投稿表单"),
    },
    1: {
      title: "填写作品资料并选择图片",
      body: "填写标题与作者署名，选择 PNG/JPEG 图片，补充英文逗号分隔的公开标签，并如实选择年龄评级。确认图片已显示在表单中。",
      tip: "图片需包含可解析的 NAI 生成参数；转载作品请正确署名。",
      target: '[role="dialog"][aria-label="提交作品"] label[for]',
      keywords: ["标题", "作者署名", "PNG/JPEG", "公开标签", "年龄评级", "NAI 生成参数"],
      screenshot: image(2, "投稿表单显示标题、作者、图片上传和公开标签字段", "本机实际操作截图 · 填写资料并选择本地图片"),
    },
    2: {
      title: "检查公开范围并确认投稿",
      body: "再次检查图片、署名、标签与年龄评级。确认是否公开提示词和生成参数；如开启点赞后查看，其他用户需登录并点赞才能查看。准备好后由你亲自点击「提交审核」。",
      tip: "请勿分享不适合公开的参考素材或个人信息。教程只预览填写结果；审计时提交请求会由本机 fixture 拦截。",
      target: '[role="dialog"][aria-label="提交作品"] > .lfn-adaptive-footer button:last-child, [role="dialog"][aria-label="提交作品"] > div:last-child button:last-child',
      keywords: ["公开提示词", "生成参数", "点赞后查看", "提交审核", "本机 fixture"],
      screenshot: image(3, "投稿表单中的公开参数开关与提交审核按钮，教程指向确认按钮", "本机实际操作截图 · 检查公开范围并确认"),
    },
    3: {
      title: "查看投稿审核状态",
      body: "前往创作者工作台的「我的投稿」查看待审核、已通过或退回状态。若被退回，按审核反馈修改后再提交；活动奖励以活动规则和实际结算为准。",
      tip: "教程完成或中途退出都会返回 /profile#profile-tutorials。",
      path: "/studio",
      target: 'a[href="#submissions"]',
      keywords: ["我的投稿", "待审核", "已通过", "退回", "活动奖励", "/profile#profile-tutorials"],
      screenshot: image(4, "创作者工作台显示我的投稿入口与审核状态", "本机实际操作截图 · 查看审核状态"),
    },
  },
};
