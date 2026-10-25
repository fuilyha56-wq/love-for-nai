# “无”预设仍追加质量词的修复

适用于电脑端与手机端的 NAI 生图。两端布局和配色不参与此次调整。

## 原因与修复

1. 兼容网关曾在处理 `qualityToggle=false` 之前，独立把 `very aesthetic, masterpiece, no text` 拼入实际生成提示词。网关现在共用同一提示词构造函数，关闭开关时不再追加；文生图、图生图、重绘、编辑及三种参考图入口均使用该逻辑。编辑接口也保留明确传入的空负面词。
2. LFN 的缓冲请求、原生流式失败后的回退、个人 NAI 兼容来源，在 `qualityToggle=false` 时额外发送 `quality_tags=""`，兼容仍独立处理后缀的旧网关。自然语言模型及未指定关闭的旧 API 默认行为保持原有语义。
3. 两端旧式提示词面板在初始化时可能先把默认预设写回存储，再读取保存的“无”。现在等待读取完成才允许写入，并取消已卸载实例的延迟恢复，避免开发模式重复初始化覆盖选择。

不会从用户手写提示词中删除同名标签，也不会重写已经生成的旧图元数据。修复针对后续生成请求与新原图。

## 回归证据

- 网关 105 项测试通过：包含七类兼容生成入口、multipart、顶层/extra_params/header 关闭开关、自定义词、既有默认行为，以及按实际请求制作 PNG 后再解析其 Comment 元数据的回归用例。
- LFN 98 项测试通过：提示词合成、NAI 原生参数、个人兼容来源、两种流式回退、PNG 解析与结果历史关联。
- 浏览器 4 组通过：1254px 的 LFN、NovelAI Local、NAI 工作台，以及 390px 手机端；实际选择“无/None”并刷新，确认选择被保留。结果见 `.tmp/quality-preset-ui-results.json`。
- TypeScript 检查通过；ESLint 无错误，桌面历史记录 Effect 保留已有的依赖提示；两仓库相关文件的差异空白检查通过。

相关源码为 `src/lib/nai-native-request.ts`、`src/lib/image-transport.ts`、`src/app/api/images/operate/route.ts` 与两端 `image/studio.tsx`；网关修复位于 `E:/novelai-gateway/src/proxy/openai.py`。测试使用替代上游生成结果，没有执行真实图像生成。
