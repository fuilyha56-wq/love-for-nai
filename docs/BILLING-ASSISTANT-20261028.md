# AFF 定价与助手更新（2026-10-28）

工作台费用区域增加独立计费卡片，手机、LFN、NAI、NLW 布局均可查看。卡片展示从服务器读取的基础价、Anlas 单价、每日阶梯、本次逐张预估和图包/个人 AFF 分摊。公开价格页使用同一数据源，读取失败时不冒充实时价格。

1 AFF 的面值为 ¥0.005。¥0.01/Anlas 对应 2 AFF/Anlas；它与生图基础费是独立项目。满足档内条件的 V5 High 首档仍收 5 AFF，Medium 与 V4.5 首档为 1 AFF。小数金额最多保留四位，不强制显示无意义的零。固定模型价优先；每日阶梯按每张的当天序号计算。

独立超分、导演工具、Vibe 编码以及关闭每日阶梯后的公式计价，现在同样读取保存的 Anlas 单价。个人 AFF 和图包使用相同公式。NewAPI 自身余额计价仍取决于其模型/分组配置。

助手可多选上传、连续粘贴最多 10 张参考图，自动压缩并按顺序提交；可逐张预览、删除或清空。目标迭代保留参考图，复核时使用前九张与最新结果。服务端限制每图大小与总大小，并在鉴权调用前拒绝非法数量。

对话历史按完整轮次和总字符预算保留，不截断 JSON；大型工具结果明确标识节选。工具调用携带对应 ID、名称及上游返回的推理/签名字段。协议参数的显式不兼容可进行有界适配，实际内容拦截、输出截断及上下文容量错误明确停止，不应用残缺建议或触发后续生成。

模型旁增加思考强度控件。支持的模型默认 high，按模型保存在浏览器中；服务端验证所选档位。DeepSeek、GLM、Qwen、GPT、Claude、Grok、Gemini 按版本提供不同档位，旧模型使用预算/开关适配，未知模型保留上游默认。Qwen 的预算与 effort 不同时发送；部分新 GPT 在 Chat Completions 中改用已有的 JSON 工具协议，避免不支持的原生函数调用和采样参数。

厂商依据（模型能力会继续变化，代理别名及渠道转换仍须与上游配置一致）：

- [DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)
- [OpenAI 推理模型](https://developers.openai.com/api/docs/guides/reasoning)
- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Qwen / GLM OpenAI 兼容参数](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions)
- [Grok 推理参数](https://docs.x.ai/developers/model-capabilities/text/reasoning)
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [NewAPI Chat Completions](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createchatcompletion)

部署凭据、用户数据、生产审计记录和私人需求报告不包含在版本库中；测试与教程使用示例数据。
