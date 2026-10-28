import { applyTutorialOverride } from "./tutorial-overrides";

export const TUTORIAL_RETURN_URL = "/profile#profile-tutorials";

export type TutorialArea = "model" | "mode" | "prompt" | "size" | "sampling" | "source" | "reference" | "characters" | "generate" | "result" | "assistant" | "editor-tools" | "editor-canvas" | "editor-params" | "editor-files" | "editor-actions" | "page";
export type TutorialStep = {
  title: string;
  body: string;
  tip?: string;
  path: string;
  area: TutorialArea;
  target?: string;
  screenshot?: { src: string; alt: string; caption?: string; width?: number; height?: number };
  keywords?: string[];
};
export type FeatureTutorial = {
  id: string;
  title: string;
  category: string;
  summary: string;
  preparation: string;
  illustration: "generate" | "reference" | "mask" | "expand" | "upscale" | "characters" | "library" | "account";
  steps: TutorialStep[];
};

const image = (title: string, body: string, area: TutorialArea, tip?: string): TutorialStep => ({ title, body, area, tip, path: "/image" });
const reference = (kind: "vibe" | "precise", title: string, body: string, tip?: string): TutorialStep => ({ ...image(title, body, "reference", tip), target: `[data-tutorial="${kind}"], .mobile-studio-reference-panel, [data-layout-module="operations"], [data-layout-module="references"]` });
const page = (title: string, body: string, path: string, target?: string, tip?: string): TutorialStep => ({ title, body, path, target, tip, area: "page" });
const editor = (title: string, body: string, area: TutorialArea, mode = "inpaint", tip?: string): TutorialStep => ({ title, body, area, tip, path: `/image/editor?mode=${mode}` });
const chooseModel = image("选择模型与模式", "在模型来源中选择账号模型或已导入的来源，再选图像模型。手机点击「参数」，在「图像操作」选择文生图；桌面点击画布上方的「当前：…」选择文生图。", "model", "模型旁的「动漫」是模型风格；生成模式从画布的「当前：…」入口选择。缺少模式时先选择支持该功能的模型。");
const prompt = image("描述想要的画面", "打开提示词，写清主体、动作、环境和画风。例如：1girl, blue hair, white dress, garden, sunlight。负向提示词填写希望排除的内容，如 blurry。", "prompt", "NAI 标签用英文逗号分隔；自然语言图像模型可以直接写完整描述。负向提示词仅在模型支持时显示。");
const generate = image("核对费用并提交", "确认模型、尺寸、张数与预计费用，再亲自点击工作台的生成按钮。等待任务结束；只想学习操作时，也可以直接进入下一步。", "generate", "教程不会替你提交生成。实际生图、重绘、超分或在线助手调用会按当前来源计费。");
const result = image("查看并保存结果", "结果出现在画布中。放大检查细节，使用下载菜单保存图片；还可以从结果操作中继续图生图、局部重绘或超分。", "result", "如果还没有生成结果，先记住画布位置，之后可以从历史再次打开。");
const upload = image("上传一张源图片", "在源图片或参考图区域点击上传，从本机选择 PNG、JPG 或 WebP；也可从生成结果或历史选择「用于…」。确认源图缩略图出现后再继续。", "source", "手机的参考图与编辑工具位于画布下方。教程不会覆盖你的提示词或自动上传图片。");
const editorSource: TutorialStep = { ...image("准备编辑图片", "先上传源图，或从已有结果选择局部重绘。桌面点击「独立重绘编辑器」或「绘制蒙版与精确重绘」，手机点击「绘制重绘蒙版」。进入编辑器后继续。", "source", "编辑器需要源图。没有图片时，请先上传，再打开编辑器；不要直接跳到下一步。"), target: '[data-tutorial="inpaint-source"], .mobile-studio-reference-panel, [data-tutorial="source"], [data-layout-module="operations"]' };
const review = editor("比较并应用", "生成完成后拖动分隔线比较原图与合成图。满意时点击「应用到工作台」；也可下载合成图、重新生成或丢弃候选结果。", "editor-actions", "inpaint", "应用会更新编辑结果；不满意时可以丢弃，再调整蒙版或提示词。");

const builtinFeatureTutorials: FeatureTutorial[] = [
  {
    id: "text-to-image", title: "生成第一张图片", category: "生图基础", summary: "从选择模型、写提示词到生成与下载。", preparation: "登录账号，并准备可用的创作额度或自己的图像来源。", illustration: "generate",
    steps: [chooseModel, prompt, image("设置画幅与张数", "找到图像尺寸，选择竖图、横图或方图。第一次先生成 1 张，使用模型允许的默认尺寸；需要横竖互换时点击交换宽高。", "size"), image("认识生成参数", "打开生成参数，先保留默认步数、相关性和采样器。种子留空表示随机；想比较不同提示词时，可固定同一个种子。", "sampling"), generate, result],
  },
  {
    id: "prompt-writing", title: "提示词、负面词与权重", category: "生图基础", summary: "组织描述、调整强调程度，保存提示词版本。", preparation: "准备一个简单场景；NAI 模型可练习标签与权重。", illustration: "generate",
    steps: [chooseModel, prompt, image("突出重点标签", "在提示词编辑器中选择需要强调的标签，使用编辑器提供的权重操作。先做小幅调整，再比较结果；不要一次给所有标签加很高的权重。", "prompt", "权重语法随模型变化，优先使用当前编辑器的控件。"), image("使用质量词与负面词预设", "打开提示词编辑器的质量词、负面词或设置菜单，选择预设，检查实际生效的内容。可在提示词库保存常用描述，之后再复用。", "prompt"), image("比较修改前后", "固定模型和种子，一次只改一组词后生成；需要回退时，在提示词版本入口查看先前内容并恢复。", "prompt"), generate, result],
  },
  {
    id: "image-to-image", title: "图生图", category: "图像编辑", summary: "保留构图，用提示词调整画面。", preparation: "准备一张本机图片，并选择支持图生图的模型。", illustration: "reference",
    steps: [image("切换到图生图", "桌面点击画布上方的「当前：…」，手机使用画布的「生成模式」，选择「图生图」。若没有此模式，先在参数里选择支持它的模型。", "mode"), upload, image("描述保留与修改内容", "提示词写出想保留的主体，再说明希望改变的服装、背景或画风。源图提供视觉信息，提示词说明本次目标。", "prompt"), image("调整变化强度", "找到变化强度。先用较低强度尝试，逐步增加以允许更大改变；尺寸尽量与原图比例接近。", "source", "强度过高可能明显改变人物、姿势和背景。"), generate, result],
  },
  {
    id: "inpaint", title: "局部重绘与蒙版", category: "图像编辑", summary: "只修改选定区域，比较并应用结果。", preparation: "准备源图；选用支持重绘的模型。", illustration: "mask",
    steps: [image("选择局部重绘模式", "桌面点击画布上方的「当前：…」，手机使用画布的「生成模式」，选择「局部重绘」，再准备源图。没有该选项时先在参数中选择支持重绘的模型。", "mode"), editorSource, editor("涂出需要修改的区域", "在精细重绘的工具中点击「绘制」，在要修改的部位涂蒙版。点击「擦除」可修正边界；适当留出周围空间，让新内容衔接自然。手机可先收起工具面板，让画布露出来。", "editor-tools", "inpaint", "LFN 蒙版约定为白色编辑、黑色保护。灰色区域表示混合；预览中的彩色涂层用于标出蒙版。"), editor("检查生成框与描述", "拖动生成框，使它覆盖蒙版及必要的周边环境。在生成参数中描述目标区域，检查模型、尺寸和变化强度。", "editor-params"), editor("生成候选结果", "确认费用后亲自点击「生成并预览」。等待候选结果出现；学习时也可以不提交，直接阅读下一步。", "editor-actions"), review],
  },
  {
    id: "outpaint", title: "扩图与无限画布", category: "图像编辑", summary: "向画面外延伸背景，补全新增区域。", preparation: "准备一张图片，通过参考图的图像编辑器进入无限画布。", illustration: "expand",
    steps: [upload, image("进入无限画布", "点击参考图旁的「无限画布」「打开图像编辑器」或「绘制草图」，进入后在顶部切换到「无限画布」。", "reference"), editor("把生成框移到画面边缘", "拖动生成框跨过原图边缘，保留一部分原图作为衔接参考，让新增区域位于框内。缩放和平移只影响观察位置。", "editor-canvas", "canvas"), editor("描述新增区域", "在生成参数写出需要延伸的场景，例如向右延伸花园、保持相同光线与透视。检查生成框范围与尺寸。", "editor-params", "canvas"), editor("生成并检查接缝", "确认费用后点击生成并预览，重点检查新增区域和原图边缘是否连贯。可重新生成或丢弃后调整。", "editor-actions", "canvas"), editor("保存扩图结果", "满意后应用到工作台，或下载合成图。继续扩展时移动生成框到另一侧，分次完成。", "editor-actions", "canvas")],
  },
  {
    id: "upscale", title: "普通超分与 V5 超分", category: "图像编辑", summary: "放大图片，检查尺寸、细节与费用。", preparation: "准备 PNG 源图；超分类型与倍率以当前模型支持为准。", illustration: "upscale",
    steps: [image("选择超分入口", "桌面点击画布上方的「当前：…」，手机使用画布的「生成模式」，选择超分或对应放大工具。也可在已有结果中点击「V5 超分」「用于超分」。", "mode"), upload, image("检查超分选项", "在超分设置中选择可用模型和倍率，核对预期输出尺寸。独立 NAI 超分仅接受 PNG，输入最大 3,145,728 像素。", "source", "普通超分与 V5 扩散超分的效果、参数和费用不同；大图片可改用分块超分。"), generate, result],
  },
  {
    id: "tiled-upscale", title: "分块超分", category: "图像编辑", summary: "分块重绘大图，自动拼接并保存。", preparation: "准备源图，选择可用的图像模型；分块流程会执行多次生成。", illustration: "upscale",
    steps: [upload, image("打开编辑器", "从参考图片进入图像编辑器。进入后，在顶部选择「分块超分」。", "reference"), editor("设置倍率与分块", "在分块超分参数中选择放大倍率、分块边长和重叠区域，查看最终尺寸与块数。先用较小倍率测试。", "editor-params", "tiled-upscale", "块数越多通常耗时与总费用越高。"), editor("设置重绘模型与强度", "选择支持的模型和来源，填写整体画面描述，调节重绘强度。想保留原图时从较低强度开始。", "editor-params", "tiled-upscale"), editor("执行分块重绘", "核对任务规模后，亲自点击「分块重绘并拼接」。观察完成块数、并发与排队状态，等待拼接完成。", "editor-actions", "tiled-upscale"), editor("检查拼接与保存", "放大检查接缝、纹理和人物细节。满意后下载合成图或应用到工作台；不满意可调整参数再尝试。", "editor-actions", "tiled-upscale")],
  },
  {
    id: "characters", title: "多角色与角色位置", category: "角色与参考", summary: "分别描述角色，安排各自的位置。", preparation: "选择支持角色提示词的 NAI 模型。", illustration: "characters",
    steps: [chooseModel, image("先写整体场景", "在主提示词描述人物数量、共同场景、构图和画风。不同人物的发色、服装等细节稍后放进各自角色框。", "prompt"), image("添加角色提示词", "在角色区域启用角色，添加需要的角色数量，分别填写每个角色的描述。支持时可填写角色专用负向词。", "characters"), image("安排角色位置", "需要手动定位时关闭自动位置，再调整每个角色的水平和垂直位置。避免人物位置完全重叠。", "characters", "位置属于生成引导，模型不保证严格落在指定坐标。"), generate, result],
  },
  {
    id: "vibe", title: "Vibe 风格迁移", category: "角色与参考", summary: "用参考图片影响画风与视觉特征。", preparation: "准备参考图，并选择支持 Vibe 的模型。", illustration: "reference",
    steps: [chooseModel, reference("vibe", "添加风格参考", "找到风格迁移或 Vibe 参考入口，从文件或参考库添加图片。标准布局可先在生成模式中选择「风格迁移」，再上传源图。确认它进入风格参考列表，而非仅作为图生图源图。"), reference("vibe", "调节参考强度与信息提取", "从一张参考、较低强度开始，调整参考强度与信息提取。前者控制影响程度，后者影响提取的参考信息。"), image("填写本次画面", "在提示词写出新的主体和构图，保留参考图中想借鉴的画风描述。Vibe 不等同于复制参考图的人物与姿势。", "prompt"), generate, result],
  },
  {
    id: "precise-reference", title: "精准参考与人物参考", category: "角色与参考", summary: "选择参考类型，控制人物或画风。", preparation: "准备清晰参考图，模型须支持相应参考能力。", illustration: "characters",
    steps: [chooseModel, reference("precise", "添加精准参考", "找到精准参考或人物参考入口，上传图片。标准布局可先在生成模式中选择「精准参考」。不要与图生图源图或 Vibe 列表混用。"), reference("precise", "选择参考类型", "根据目标选择人物、风格或人物与风格，调整界面提供的参考强度与约束选项。", "多个参考的总量与组合受当前模型限制。"), image("补充目标动作与场景", "主提示词描述当前动作、场景和镜头，角色描述补充想保留的外观；先用单张参考观察影响。", "prompt"), generate, result],
  },
  {
    id: "director", title: "去背景、线稿、上色与表情", category: "图像编辑", summary: "使用导演工具处理已有图片。", preparation: "准备源图，当前来源需要支持所选图像工具。", illustration: "reference",
    steps: [image("选择图像工具", "桌面点击画布上方的「当前：…」，手机使用画布的「生成模式」，选择去背景、提取线稿、草图、上色或表情等操作。也可以使用图像工具或导演工具入口。", "mode"), upload, image("填写工具专用选项", "上色时描述目标颜色，表情工具选择想要的情绪；其他工具按界面填写必要选项。当前来源不支持时请更换来源。", "source"), generate, result],
  },
  {
    id: "tag-assistant", title: "识图与标签助手", category: "提示词与资料", summary: "上传图片识别标签，整理并插入提示词。", preparation: "在线助手需要可用模型和额度；本地识图需要先导入 ONNX 模型。", illustration: "reference",
    steps: [image("打开标签助手", "手机点击右上角「助手」，桌面打开功能区中的标签助手。选择在线助手模型，或使用已经配置的本地标签模型。", "assistant"), image("上传要分析的图片", "在助手或图片反推区域添加图片，输入任务，如「识别人物服装和背景标签，并按主题整理」。", "assistant"), image("运行并检查识别结果", "亲自提交识别，等待结果。检查错认的人物、颜色和细节；本地 tagger 可以调整通用标签与角色标签阈值。", "assistant", "在线助手使用对应模型额度，本地标签推理需要浏览器支持相应运行环境。"), image("加入提示词并修改", "使用结果中的插入、应用或复制操作，将所需标签放到提示词里。删除无关标签，再补充本次希望修改的内容。", "prompt")],
  },
  {
    id: "tag-library", title: "标签词库与检索", category: "提示词与资料", summary: "搜索标签、查看解释并整理自己的词库。", preparation: "准备想表达的主体、服装或场景关键词。", illustration: "library",
    steps: [page("打开标签词库", "在词库页面使用搜索，输入英文标签或支持的中文关键词。", "/tags", ".workspace-page input[type='search'], .workspace-page input"), page("查看标签信息", "从结果中查看标签、翻译、分类和可用说明。先确认含义，再选择添加或复制，避免把相似词全部堆进提示词。", "/tags", ".workspace-page"), page("整理常用标签", "将常用内容加入个人词库或使用页面提供的收藏、复制功能。回到工作台后，使用提示词补全或粘贴内容继续创作。", "/tags", ".workspace-page"), image("在提示词中复用", "输入标签开头查看补全建议，将选好的词加入描述。检查逗号分隔与重复词，再保存到常用提示词。", "prompt")],
  },
  {
    id: "history", title: "图片历史、下载与参数复用", category: "提示词与资料", summary: "找回作品，下载并继续编辑。", preparation: "生成过至少一张图片；没有记录时可先了解操作位置。", illustration: "library",
    steps: [page("打开个人图片历史", "进入图片历史，使用页面提供的筛选或搜索找到作品。本机历史与服务端历史的可见范围可能不同。", "/history", ".workspace-page"), page("查看详情与下载", "点击图片查看大图和记录，使用下载菜单保存文件。需要生成参数时，选择包含参数的下载方式并核对公开范围。", "/history", ".workspace-page"), page("复用参数或继续编辑", "在详情或记录操作中选择导入工作台、图生图、重绘或超分。导入后先检查模型、提示词和尺寸，再提交新任务。", "/history", ".workspace-page"), image("核对导入结果", "确认工作台中出现预期的提示词与源图。复用种子可帮助比较，但跨模型或服务版本不保证完全相同的结果。", "prompt")],
  },
  {
    id: "gallery", title: "广场搜索与作品导入", category: "社区与分享", summary: "搜索作品、筛选标签、下载或复用。", preparation: "部分作品会按分级遮罩，参数能否导入由作者公开设置决定。", illustration: "library",
    steps: [page("搜索与筛选", "在广场搜索框输入关键词，选择标签建议，配合页面提供的分级、排序和筛选缩小结果。", "/gallery", ".discovery-controls, .workspace-page form, .workspace-page"), page("打开作品详情", "点击作品查看大图、标签与作者信息。遮罩内容按页面提示操作；没有结果时先移除部分筛选条件。", "/gallery", ".workspace-page"), page("下载或导入工作台", "在作品详情选择下载或导入。只有作者公开的参数才能复用；评论与作品说明不能替代实际参数。", "/gallery", ".workspace-page"), image("检查复用参数", "导入后确认模型、提示词、角色与参考图。缺失的参考或不可用模型需要手动补齐，再确认费用。", "model")],
  },
  {
    id: "gallery-submit", title: "投稿、标签与活动", category: "社区与分享", summary: "整理作品资料，确认公开范围后投稿。", preparation: "准备可分享的作品；最终提交由你亲自确认。", illustration: "library",
    steps: [page("找到投稿入口", "在图片广场点击投稿，或从自己的历史选择分享作品。", "/gallery", ".workspace-page"), page("补充作品信息", "选择图片，填写标题、说明、标签和分级。需要参与活动时选择符合要求的活动，并阅读规则。", "/gallery", ".gallery-submit-dialog, [role='dialog'], .workspace-page"), page("检查公开范围并提交", "检查提示词和参数是否公开、分级是否准确，以及参考素材是否适合分享。确认后亲自点击提交；教程不会替你投稿。", "/gallery", ".gallery-submit-dialog, [role='dialog'], .workspace-page"), page("查看审核状态", "在我的投稿或作品页面查看状态。若被退回，按反馈修改后再提交；活动奖励以活动规则与实际结算为准。", "/gallery", ".workspace-page")],
  },
  {
    id: "stories", title: "故事创作、续写与分支", category: "故事与个性化", summary: "创建故事、选择模型、续写与比较分支。", preparation: "需要可用的故事文本模型；文字冒险暂未开放。", illustration: "library",
    steps: [page("创建或打开故事", "在故事工作台选择 Storyteller，新建故事并填写名称、类型与标签，也可打开已有故事。", "/stories", ".story-mode-grid, .story-dashboard, .stories-auth-panel"), page("准备正文与模型", "打开故事后选择可用模型，写下开头、人物关系和当前情节。模型未配置时先到模型与密钥添加。", "/stories", ".story-editor-shell, .story-dashboard"), page("续写、改写与插入", "使用续写扩展当前正文；改写前先选中文本，插入时先放置光标。提交前检查本次任务与模型。", "/stories", ".story-editor-shell, .story-dashboard"), page("使用分支比较剧情", "在故事分支入口建立不同走向，分别编辑后比较。保留满意版本，并在故事设置中完善故事信息。", "/stories", ".story-editor-shell, .story-dashboard")],
  },
  {
    id: "layout", title: "主题与工作台布局", category: "故事与个性化", summary: "调整主题、模块顺序、显隐与栏宽。", preparation: "布局和部分外观偏好保存在当前设备。", illustration: "generate",
    steps: [page("选择外观", "在外观与界面中选择主题、强调色、密度和动效。手机与桌面会按各自界面应用偏好。", "/settings#appearance", ".settings-content"), page("打开布局编辑器", "进入布局编辑器，先观察左右分区与固定画布的位置。", "/image/setting/layout", ".layout-editor-preview"), page("调整模块", "在允许的分区内拖动模块改变顺序，切换显隐并调整栏宽。画布与生成按钮保持固定。", "/image/setting/layout", ".layout-editor-preview"), page("保存并检查", "点击布局编辑器的保存或应用按钮，返回图片工作台检查提示词、参数与工具是否方便使用。不满意可重新调整。", "/image/setting/layout", ".layout-editor-preview")],
  },
  {
    id: "providers", title: "导入自己的 API 或 NAI Key", category: "账号与接入", summary: "添加图像来源，回到工作台选用。", preparation: "准备服务商提供的地址、模型 ID 与 Key，不要把密钥写进提示词或公开内容。", illustration: "account",
    steps: [page("打开图像来源设置", "进入模型与密钥中的自定义图像来源。选择 OpenAI 兼容图像 API 或 NovelAI 官方来源。", "/settings#custom-providers", "#custom-providers"), page("填写连接信息", "OpenAI 兼容来源填写地址、模型 ID 和 Key；NovelAI 来源导入官方 Key。按页面要求填写，避免地址重复拼接。", "/settings#custom-providers", "#custom-providers"), page("保存并检查来源", "亲自保存来源，查看可用状态或订阅信息。第三方来源的费用和限额以对应服务商为准。", "/settings#custom-providers", "#custom-providers"), image("在工作台切换来源", "在模型来源中选择刚添加的来源，再选择对应模型。先检查该模型支持的模式与参数，再提交生成。", "model")],
  },
  {
    id: "wallet", title: "签到、兑换码与创作额度", category: "账号与接入", summary: "查看余额、签到与奖励流水。", preparation: "登录账号；奖励规则与购买价格以页面显示为准。", illustration: "account",
    steps: [page("查看创作额度", "在个人资料查看 AFF、图包额度与 NewAPI 余额。不同额度的适用功能和扣费顺序以钱包说明为准。", "/profile#profile-wallet", ".profile-wallet-card"), page("每日签到", "在每日签到中查看今日状态与奖励，点击签到后检查余额或流水。每个中国标准时间日可签到一次。", "/profile#profile-rewards", ".profile-checkin-card"), page("兑换奖励", "在兑换码区域填写有效代码，确认后亲自兑换。成功后检查兑换记录与 AFF 变化。", "/profile#profile-redeem", "#profile-redeem"), page("检查账单", "在使用记录核对每次调用、费用与请求状态。自带 API 的上游费用还需要在对应服务商核对。", "/usage", ".workspace-page")],
  },
  {
    id: "api-access", title: "创建密钥与外部客户端接入", category: "账号与接入", summary: "创建 LFN API 密钥，配置外部工具。", preparation: "选择一个外部客户端，密钥只保存在可信设备。", illustration: "account",
    steps: [page("打开对外 API 密钥", "在模型与密钥中找到 LFN 对外 API 密钥。它用于外部工具访问本站，和导入图像来源用的上游 Key 不同。", "/settings#api-tokens", "#api-tokens"), page("亲自创建并保存密钥", "填写可辨认的名称，创建后复制到安全位置。请勿在评论、截图或公开作品中展示密钥。", "/settings#api-tokens", "#api-tokens"), page("选择接入协议", "在文档中根据客户端选择 NAI 原生 /ai 或 OpenAI 兼容 /v1。按对应教程填写站点地址、密钥和模型。", "/docs?slug=api-keys-and-clients", "article"), page("用小请求验证", "先发送一张小尺寸图片的请求，核对返回格式与使用记录。地址拼接或鉴权失败时，按文档的常见错误排查。", "/docs?slug=troubleshooting", "article")],
  },
];

export const featureTutorials = builtinFeatureTutorials.map(applyTutorialOverride);
export const tutorialCategories = [...new Set(featureTutorials.map((item) => item.category))];
export function findFeatureTutorial(id: string) {
  return featureTutorials.find((item) => item.id === id);
}
