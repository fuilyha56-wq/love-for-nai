# 图像模型与本地反推支持

本文说明 LFN 当前实现的协议与功能边界。模型名称、账号权限和上游实际接口都必须匹配；加入模型 ID 并不意味着该上游支持所有功能。

## 协议与配置

| 选择 | 实际请求 | 用途 |
| --- | --- | --- |
| 自动 | NAI 使用现有 NAI 通道，其他模型默认 Images API | NewAPI 的默认兼容方式；不会仅凭 Gemini 名称切换到 Google 接口 |
| OpenAI Images | `POST /v1/images/generations` JSON；带图片时 `POST /v1/images/edits` multipart | GPT Image、DALL·E，以及实现这些端点的网关 |
| Gemini 原生 | `POST /v1beta/models/{模型ID}:generateContent`，`contents` 文本与 `inlineData` 图片，`responseModalities: ["TEXT", "IMAGE"]` | Gemini / Nano Banana 的原生图像接口 |
| 聊天生图兼容 | `POST /v1/chat/completions`，多模态 `messages`，`modalities: ["text", "image"]` | 支持这种图像输出格式的网关；普通文本聊天接口不适用 |

NewAPI 账号在画布的“NewAPI 图像接口协议”中选择上游支持的方式。Gemini 经转发商接入时，可能采用 Images、Gemini 原生或聊天生图接口，须按转发商配置选择。非 NAI 图像请求使用 NewAPI 图像额度，不消耗 NAI AFF 套餐。

个人来源在设置的“模型与密钥 → 个人 API 来源”中添加，填写 Base URL、自己的 API Key、协议及模型 ID。示例：

| 来源 | Base URL | 协议 | 模型 ID 示例 |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com` | OpenAI Images | `gpt-image-1.5` |
| Google | `https://generativelanguage.googleapis.com` | Gemini 原生 | `gemini-2.5-flash-image` |

模型 ID 须已向自己的账号开放；可手动填写，发现接口不可用时仍可保存。个人来源仅接受公共 HTTPS 地址，Base URL 无需附加 `/v1` 或 `/v1beta`。个人 Google 官方地址选“自动”时会识别为 Gemini 原生；Google 的 `/v1beta/openai` 地址也可使用，自动 / Gemini 原生协议会走原生路径，显式 OpenAI 协议走兼容路径。其他网关继续遵循所选协议。当前没有实现 Imagen 的 `predict` 接口。

接口与模型行为可参阅 [OpenAI 图像生成文档](https://developers.openai.com/api/docs/guides/image-generation)和 [Google Gemini / Nano Banana 图像生成文档](https://ai.google.dev/gemini-api/docs/image-generation)。

## 功能如何适配

| 模型类别 | 生图 | 图生图、蒙版重绘、扩图 | 风格、角色、精确参考 | 导演工具、放大 |
| --- | --- | --- | --- | --- |
| NAI | 原有标签与原生参数 | 原有 NAI 请求 | 原生 Vibe、角色和精确参考参数 | 原有网关操作，取决于上游支持 |
| GPT Image | 自然语言描述 | Images 编辑接口；蒙版转换为透明区域可编辑的 alpha mask | 多张输入图片与身份、风格描述 | 编辑指令适配 |
| Gemini / Nano Banana | 自然语言描述 | 原图与编辑指令；蒙版作为额外参考图 | 多张图片与身份、风格描述 | 编辑指令适配 |
| DALL·E 2 | Images API | 单张编辑原图与原生蒙版 | 仅一张输入图；不能组合多图参考 | 通过单图编辑指令，仍受上游限制 |
| DALL·E 3、未知 Images 模型 ID | 生图 | 当前不开放 | 当前不开放 | 当前不开放 |

未知模型别名只有在明确选择 Gemini 或聊天生图协议时才开放相应编辑适配。DALL·E 2 编辑原图还须为小于 4 MiB 的正方形 PNG。个人 NovelAI 官方 Key 当前仅开放生图、图生图、重绘、扩图及三类参考，尚未开放导演工具、放大和旧版 `suggest-tags` 操作。

非 NAI 的“导演”包括清理画面、移除背景、线稿、素描、上色与表情修改，实际执行的是图像编辑指令。参考强度、角色位置和图生图变化程度也转为描述，不是 NAI 原生控制参数。去背景在支持透明输出的 GPT 接口请求透明 PNG，其他接口按指令处理，不能保证得到透明背景。非 NAI 放大先请求细节增强，再调整为原图的两倍尺寸；它不等同于 NAI 原生扩散超分。

LFN 蒙版约定为白色编辑、黑色保护。GPT / DALL·E 2 转换为原生 alpha mask；Gemini 与聊天生图将蒙版作为图片参考。非 NAI 返回后会按蒙版与原图合成，恢复黑色保护区的像素，灰色区域混合。编辑区内容仍由模型决定；[OpenAI 官方也说明 GPT Image 的蒙版属于编辑引导，模型不保证严格按蒙版边界生成](https://developers.openai.com/api/docs/guides/image-generation)。

非 NAI 请求不会发送 NAI 的 CFG、采样器、种子、质量标签、UC 预设和原生角色参数；负向描述转为自然语言避免项。GPT Image 1 / 1.5 尺寸会归一为三种支持尺寸；GPT Image 2 系列按当前能力表的 16 像素倍数、面积与比例约束归一。GPT 的原生质量与背景选项仅在 Images 协议使用，其他协议的透明背景转为描述引导。Gemini 原生协议使用支持的宽高比与 `imageConfig.imageSize` 档位：2.5 Flash Image 与 3.1 Flash Lite Image 仅提供 1K，支持高分辨率的对应 3 系列可选 2K / 4K，3.1 Flash Image 还可选 512。Images / 聊天生图网关不使用通用 `imageSize` 参数。具体档位会在服务端检查，不直接透传任意尺寸。

## 提示词助手与图像模型

图像模型负责生成图片；助手的文本 / 视觉模型负责聊天、整理提示词和看图反推，两者分别选择。添加个人 OpenAI 或 Google **图像** Key 不会自动配置助手；助手继续使用账号已配置且有权限的 NewAPI 文本 / 视觉模型。看图任务还要求该助手模型支持图片输入。

助手请求携带当前图像模型、协议和操作：NAI 保留 Danbooru 标签与权重处理；GPT / Gemini 生成完整场景描述或编辑指令，不强制把自然语言转换为标签，也不会建议该模型没有的 CFG、采样器或种子。ONNX 标签可作为视觉线索交给助手。自然语言提示词的场景、构图和编辑描述方式参见 [Google 图像提示词指南](https://ai.google.dev/gemini-api/docs/image-generation)。

## 本地 ONNX tagger

在设置的“本地 ONNX 标签反推”导入 WD tagger 的 `.onnx` 与**同一模型配套**的 `selected_tags.csv`，放在同一文件夹。模型如使用 `.data`、`.bin` 或 `.onnx_data` 外部权重，也要同目录一并选择并保留文件名。可从 [SmilingWolf 的 WD 模型页面](https://huggingface.co/SmilingWolf/wd-v1-4-convnext-tagger-v2)获取模型与标签文件；只输入 Windows 文件路径不会授予浏览器读取权限，须使用文件 / 文件夹选择器。

当前兼容单输入、单输出的 WD 类型模型：float32 四维 NHWC / NCHW，3 通道，批次为 1 或动态，固定正方形输入边长 1–2048；输出须为与 CSV 行数一致的 float32 概率。CSV 上限 16 MB、1–100000 条标签；任意 ONNX 模型不保证可用。预处理为透明区域合成白色、居中白色补边与高质量缩放，输入 BGR float32 的 0–255 数值；浏览器缩放与 Python/PIL 不保证逐像素相同。

通用标签阈值默认 `0.35`，角色标签默认 `0.85`，仅返回超过阈值的对应类别。模型保存在当前浏览器、当前站点的 IndexedDB，偏好保存在 localStorage；不同浏览器、设备、`localhost` 与部署站点不会共享，清除站点数据会移除模型。模型文件没有固定大小上限，但受浏览器存储配额和 WASM 内存限制。

推理由 Worker 中的 ONNX Runtime Web WASM 执行，取消会终止 Worker。运行时文件通过 `npm run dev` / `npm run build` 的前置脚本同步到 `public/onnx`；使用方式参见 [ONNX Runtime Web 官方文档](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)。只开启 ONNX 时图片与模型在浏览器处理；**同时开启 LLM 反推会把图片发送给已配置的视觉助手**。导入模型会启用 ONNX，但不会自动关闭已有的 LLM 选项。

## 验证范围

```sh
npm test
npx vitest run tests/browser-tagger.test.ts tests/browser-tagger-runtime.test.ts
```

协议、助手和路由测试使用 mock 上游，覆盖请求格式、功能限制、蒙版处理及权限等逻辑。WASM 测试实际运行 ONNX Runtime Web 1.30.0，通过依赖像素输入的 220 字节测试模型验证 BGR、输出与阈值，并非完整 WD 模型的识别质量或大型模型性能测试。

本次未调用真实 GPT / Gemini 图像上游，也未下载完整 WD 大模型。上线前仍需用实际可用的模型与 Key 验证生图、原图编辑、蒙版重绘、参考图和历史结果；本地反推可先关闭 LLM，只验证已导入 WD 模型的推理与阈值，再单独验证视觉助手。
