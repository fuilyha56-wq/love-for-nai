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

目标 Agent 的完全访问模式现在支持自定义 1～100 轮，默认 5 轮，每轮 1 张。设置按浏览器记忆，任务启动后固定本次上限；最后一张仍会复核，到达上限不会继续生成。

助手新增上下文与消耗卡片：最近一次调用的输入 token、累计输入/输出/总 token、缓存与推理子项、NewAPI 模型调用实际额度，以及目标迭代的生图费用。普通助手显示最近任务，目标 Agent 按当前运行累计；缓存和推理 token 不重复叠加到总量。上游未报告的项目明确标注，未入账的费用显示待结算并可刷新。

NewAPI 额度按当前账号与服务器收到的请求编号精确读取消费日志，再按本站显示额度单位换算；不使用其他并发请求也会影响的余额差值推测。生图读取扣除退款后的实际 AFF，区分图包/个人 AFF 与 NewAPI 余额单位。任务停止后已经发出的模型调用仍可刷新结算；用量接口只返回当前用户的计数与费用，不返回模型消息、提示词或密钥。
