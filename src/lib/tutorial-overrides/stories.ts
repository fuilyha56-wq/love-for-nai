import type { TutorialOverride } from "./types";

const screenshot = (step: number, alt: string, caption: string) => ({
  src: `/tutorials/stories/step-${String(step).padStart(2, "0")}.png`,
  alt,
  caption,
  width: 1440,
  height: 1000,
});

export const tutorialOverride: TutorialOverride = {
  preparation: "需要登录并配置一个可用的故事文本模型。教程操作使用本机浏览器 fixture；不会保存真实故事或请求上游模型。文字冒险暂未开放。",
  summary: "从 Storyteller 创建故事、准备正文、用模型续写，再建立分支比较不同剧情。",
  steps: {
    0: {
      title: "创建 Storyteller 故事",
      body: "在故事工作台点「新故事」，选择 Storyteller 并填写类型与标签，然后创建故事。手机表单还可填写标题；Text Adventure 当前标记为即将开放。",
      tip: "已有故事可直接打开。类型和标签之后仍可在故事设置中调整。",
      area: "page",
      target: ".story-dashboard .launcher-story-actions button, .story-empty-state, .story-mode-grid .story-mode-card:first-child, .story-create-form",
      keywords: ["故事工作台", "新故事", "Storyteller", "类型与标签", "创建故事", "Text Adventure", "即将开放"],
      screenshot: screenshot(1, "故事工作台中的新故事入口与 Storyteller 创建方式", "本机界面截图 · 创建 Storyteller 故事"),
    },
    1: {
      title: "准备正文并选择模型",
      body: "在正文编辑区写下故事开头，再打开「故事设置」检查当前文本模型。续写会使用当前分支正文、故事信息和所选模型作为上下文。",
      tip: "没有可用模型时，先通过「管理模型源」配置文本模型；图像模型不能代替故事模型。",
      area: "page",
      target: ".story-prose-editor, .story-settings-drawer.is-open [aria-label=\"故事 AI 模型\"], [role=\"dialog\"][aria-label=\"故事设置\"] [aria-label=\"故事 AI 模型\"]",
      keywords: ["正文编辑区", "故事设置", "文本模型", "当前分支正文", "管理模型源"],
      screenshot: screenshot(2, "故事编辑器的正文输入区和故事 AI 模型设置入口", "本机界面截图 · 准备正文与文本模型"),
    },
    2: {
      title: "续写当前剧情",
      body: "在本次生成指令中写下期望的走向，保留「续写」模式并发送。检查返回文本是否接续当前情节；教程中的响应由本地 route fixture 提供。",
      tip: "改写前先选中正文片段；插入会从光标位置开始。每次发送前确认模式和当前分支。",
      area: "page",
      target: ".story-generation-dock .story-instruction-row input, .story-generation-mode, [aria-label=\"故事生成方式\"], .story-send-button",
      keywords: ["本次生成指令", "续写", "发送", "本地 route fixture", "改写", "选中正文片段", "插入", "当前分支"],
      screenshot: screenshot(3, "故事编辑器中的续写模式、生成指令和发送按钮", "本机界面截图 · 续写当前剧情"),
    },
    3: {
      title: "创建分支并比较剧情",
      body: "打开「管理故事分支」，从当前正文创建新分支。确认分支列表出现新走向，再切换分支查看独立正文；主线仍保留。",
      tip: "分支正文会分别保存。切换前确认编辑已自动保存，再继续创作或比较剧情。",
      area: "page",
      target: ".story-editor-actions [aria-label=\"管理故事分支\"], .story-branch-popover, [role=\"dialog\"][aria-label=\"故事分支\"]",
      keywords: ["管理故事分支", "当前正文", "新分支", "独立正文", "主线", "自动保存"],
      screenshot: screenshot(4, "故事编辑器中的分支入口和分支列表", "本机界面截图 · 创建分支并比较剧情"),
    },
  },
};
