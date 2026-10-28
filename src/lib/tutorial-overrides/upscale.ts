import type { TutorialOverride } from "./types";

export const tutorialOverride: TutorialOverride = {
  preparation: "准备一张本机 PNG、JPG 或 WebP 源图，并选择可用的图像模型和来源。V5 专用超分会将输入固定放大为 2 倍；其他图像模型按其编辑能力处理，倍率与输出尺寸以当前界面和模型为准。",
  summary: "选择图像模型与普通放大方式，导入源图，再从历史图片进入 V5 专用超分，核对费用并查看下载结果。",
  steps: {
    0: {
      title: "选择模型与普通放大方式",
      body: "在「模型来源」选择可用来源，再选一个支持图像编辑的图像模型。手机先打开「参数」；桌面在左侧「模型与模式」区域操作。普通放大从生成模式选择「放大」；桌面工作台可用「图生图」按所选模型的编辑能力处理输入图。",
      tip: "NAI V5 专用超分从已有结果或历史图片的「V5 超分」「用于超分」入口启动，与生成模式中的普通「放大」分开。",
      target: '.studio-model-controls .popup-select-trigger[aria-label="模型"], .replica-model-controls [aria-label="模型"], .mobile-studio-workspace-dialog [aria-label="模型"]',
      keywords: ["模型来源", "支持图像编辑", "图像模型", "普通放大", "生成模式", "放大", "图生图", "V5 专用超分", "已有结果", "历史图片", "用于超分"],
      screenshot: { src: "/tutorials/upscale/step-01.png", alt: "本机工作台中选择 NAI V5 图像模型及普通图生图模式的实际界面", width: 1440, height: 1000, caption: "本机实际界面截图 · 选择模型与普通编辑方式" },
    },
    1: {
      title: "上传本机源图",
      body: "在源图片区域点击上传，选择本机 PNG、JPG 或 WebP。看到文件名和缩略图后再继续；已有结果或历史图片也可以使用「用于超分」带入。",
      tip: "文件在当前本地浏览器中读取。NAI 独立超分会将图片转为 PNG 后处理；原始输入不能超过 3,145,728 像素。",
      target: '.mobile-studio-reference-panel, [data-tutorial="source"]',
      keywords: ["源图片", "上传", "本机", "PNG", "JPG", "WebP", "文件名", "缩略图", "用于超分", "3,145,728 像素"],
      screenshot: { src: "/tutorials/upscale/step-02.png", alt: "本机图像工作台中的源图片上传区域及已载入源图", width: 1440, height: 1000, caption: "本机实际界面截图 · 导入源图" },
    },
    2: {
      title: "从结果或历史启动 V5 超分",
      body: "在画布结果或历史图片上选择「V5 超分」或「用于超分」，工作台会带入图片并进入专用超分操作。选择「V5 Curated（推荐）」或「V5 Full」；这条路径固定输出为源图的 2 倍，只接受 PNG。普通图生图则使用已选图像模型的编辑能力，不显示 V5 超分模型框。",
      tip: "独立 NAI 超分按源图尺寸档位计费；超过 1536×2048（3,145,728 像素）会被拦截。大图可考虑单独的「分块超分」教程。",
      target: '[aria-label="超分模型"], .studio-model-controls .popup-select-trigger[aria-label="模型"], .mobile-studio-mode-selector',
      keywords: ["NAI", "超分模型", "V5 Curated", "V5 Full", "固定", "2 倍", "PNG", "普通模型编辑", "输出尺寸", "源图尺寸档位", "1536×2048", "3,145,728 像素", "分块超分"],
      screenshot: { src: "/tutorials/upscale/step-03.png", alt: "本机工作台的 V5 超分模型选项与固定二倍输出说明", width: 1440, height: 1000, caption: "本机实际界面截图 · 选择 V5 超分并核对固定二倍输出" },
    },
    3: {
      title: "检查费用并提交超分",
      body: "核对源图尺寸、当前来源和页面显示的预计费用。NAI 独立超分显示源图尺寸、固定 2 倍输出与 AFF 费用档位；普通模型编辑的费用按当前模型和来源计算。确认后亲自点击工作台的生成按钮。",
      tip: "审计用本地 fixture 截获生成请求，不会真实生成或上传到外部服务器。平时练习时可以不提交，直接阅读结果步骤。",
      target: '[data-layout-module="generate"] button[data-studio-generate], button[data-studio-generate]',
      keywords: ["源图尺寸", "当前来源", "预计费用", "2 倍输出", "AFF", "模型", "生成按钮", "本地 fixture", "不会真实生成", "外部服务器"],
      screenshot: { src: "/tutorials/upscale/step-04.png", alt: "本机工作台的超分费用说明和生成按钮", width: 1440, height: 1000, caption: "本机实际界面截图 · 核对费用并提交" },
    },
    4: {
      title: "检查并下载超分结果",
      body: "任务完成后放大查看主体、纹理和边缘，确认输出尺寸符合预期。打开结果旁的「下载」菜单保存图片；也可以从结果操作重新带入源图继续处理。",
      tip: "操作完成后点击教程中的「完成教程，返回教程中心」；想提前结束则点「退出教程，返回个人资料的教程中心」。两种方式都会回到个人资料的功能教程。",
      target: '.workspace-result-download summary, .replica-media .replica-download-menu summary, .mobile-studio-preview-section .image-download-menu summary',
      keywords: ["任务完成", "放大查看", "主体", "纹理", "边缘", "输出尺寸", "下载", "完成教程", "退出教程", "个人资料", "功能教程"],
      screenshot: { src: "/tutorials/upscale/step-05.png", alt: "本机图像工作台中超分结果和下载菜单的实际界面", width: 1440, height: 1000, caption: "本机实际界面截图 · 检查结果与下载" },
    },
  },
};
