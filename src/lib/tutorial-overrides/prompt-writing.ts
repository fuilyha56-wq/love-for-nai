import type { TutorialOverride } from "./types";

const screenshot = (step: number, alt: string) => ({
  src: `/tutorials/prompt-writing/step-${String(step).padStart(2, "0")}.png`,
  alt,
  width: 1440,
  height: 1000,
  caption: "本地应用实际界面截图；图像与模型响应均使用本地演示数据。",
});

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一句简单的画面描述。请先确认模型来源已连接、图像模型列表已加载；没有可选模型时，先在模型设置中配置可用来源再开始。练习只需修改提示词，不必提交真实生图。",
  summary: "选择可用的图像模型，撰写正向与负向描述，用标签权重和预设逐步整理提示词，再对照版本并查看生成结果。",
  steps: {
    0: {
      title: "确认模型来源与图像模型",
      body: "先等待「模型来源」与「模型」选项加载。选择已连接且可用的图像模型，并确认生成模式为「文生图」；如果模型列表为空或仍显示加载状态，先检查来源配置与连接，再继续。",
      tip: "请勿在模型不可用时盲目继续：模型决定标签、负向词与权重的实际解释方式。手机端从「参数」检查，桌面端使用模型与模式区域。",
      target: '.studio-model-controls, [data-layout-module="model"]',
      keywords: ["模型来源", "模型", "文生图", "列表为空", "加载状态"],
      screenshot: screenshot(1, "本地图片工作台的模型来源、图像模型与生成模式入口"),
    },
    1: {
      title: "分别写正向提示词和负向内容",
      body: "在「提示词」输入希望画面出现的主体、动作、环境和风格；在「负向提示词」或「排除内容」中列出希望避免的问题。NAI 标签可用英文逗号分隔，例如：1girl, blue hair, white dress, garden, sunlight。",
      tip: "自然语言模型可以直接写完整句子；负向输入是否生效取决于当前模型。先写少量具体信息，逐步观察变化。",
      target: '[data-tutorial="prompt"] textarea, [data-layout-module="prompt"] textarea, .replica-prompt textarea, .mobile-studio-prompt-content textarea',
      keywords: ["正向提示词", "负向提示词", "排除内容", "英文逗号分隔"],
      screenshot: screenshot(2, "提示词编辑器中实际可输入的正向和负向描述区域"),
    },
    2: {
      title: "用标签权重强调一个重点",
      body: "在标签编辑器中选中一个需要强调的标签，再用右键菜单选择「增加权重 (+0.05/+1层)」。一次只调整少数重点，并查看标签外层显示的权重语法。",
      tip: "可用「减少权重」或「重置权重」修正。不同模型对花括号、方括号和数字权重的解释不同，优先使用当前编辑器的菜单。",
      target: '[data-tutorial="prompt"] .replica-prompt [aria-label="标签模式"], [data-layout-module="prompt"] .replica-prompt [aria-label="标签模式"], .replica-prompt [aria-label="标签模式"]',
      keywords: ["选中", "右键菜单", "增加权重", "减少权重", "重置权重"],
      screenshot: screenshot(3, "提示词标签编辑器中的标签权重操作区域"),
    },
    3: {
      title: "检查质量词与负面预设",
      body: "按当前模型支持情况查看「质量词」和「负面预设 (UC)」。打开预设选项，选择适合的等级或内容；界面会把质量词追加到正向提示词，并把负面预设加入排除内容。",
      tip: "模型可能不显示其中一类预设。切换预设前先检查它是否与自己写的词重复，避免无意覆盖表达。",
      target: '[data-tutorial="prompt"] .replica-prompt-toolbar .replica-preset-button[aria-label="选择质量词"], [data-layout-module="prompt"] .replica-prompt-toolbar .replica-preset-button[aria-label="选择质量词"], .replica-prompt-toolbar .replica-preset-button[aria-label="选择质量词"], [data-layout-module="prompt"] .replica-nai-prompt-card footer .replica-preset-button',
      keywords: ["质量词", "负面预设", "UC", "正向提示词", "排除内容"],
      screenshot: screenshot(4, "提示词编辑器中质量词与负面预设的实际控件"),
    },
    4: {
      title: "查看并对比提示词版本",
      body: "修改提示词后，打开「提示词版本」记录，查看刚才自动保存的内容。选择两个版本可以逐项对照；需要回退时再选择要恢复的版本。",
      tip: "版本记录保留最近一段时间内的编辑；没有记录时，先修改并稍等片刻再打开。",
      target: '[data-tutorial="prompt"] button[aria-label="提示词版本"], [data-layout-module="prompt"] button[aria-label="提示词版本"], .replica-prompt button[aria-label="提示词版本"]',
      keywords: ["提示词版本", "自动保存", "对照", "恢复"],
      screenshot: screenshot(5, "提示词编辑器中打开版本记录的入口"),
    },
    5: {
      title: "核对参数后提交或跳过生成",
      body: "确认模型、尺寸、张数和费用后，由你决定是否点击工作台的生成按钮。只学习提示词操作时，可以跳过提交并直接阅读下一步。",
      tip: "实际生成会使用当前模型来源并可能收费；教程不会替你提交任务。",
      target: '.replica-run-button, [data-layout-module="generate"] [data-studio-generate], [data-studio-generate]',
      keywords: ["模型", "尺寸", "张数", "费用", "生成按钮", "跳过提交"],
      screenshot: screenshot(6, "本地图片工作台中核对后提交生成的按钮"),
    },
    6: {
      title: "检查生成结果并保存",
      body: "在结果区域检查主体、构图和细节，再用下载菜单保存图片。若结果与预期有差异，回到提示词版本对比修改，一次调整一组词后再尝试。",
      tip: "还没有结果时，可以先完成本步骤阅读；之后也能从历史记录打开作品。",
      target: '.mobile-studio-preview-section, .replica-media, [data-layout-module="canvas"]',
      keywords: ["结果区域", "下载", "提示词版本", "历史记录"],
      screenshot: screenshot(7, "工作台生成结果预览区域；没有生成时显示空状态提示"),
    },
  },
};
