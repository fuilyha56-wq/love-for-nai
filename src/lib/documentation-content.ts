/** Built-in guide revision, derived from the current routes and billing code. */
export const DOCUMENTATION_REVISION = 20261013;
export const currentDocumentation: Record<string, string> = {
  "api-overview": `# API 接入总览

LFN 提供 NovelAI 原生格式、OpenAI 图像兼容格式和站内登录接口。站点地址应填写 LFN 的地址。

## 入口与鉴权

- **/ai**：NovelAI 客户端、NAI Launcher 与脚本使用的原生格式接口。
- **/v1**：OpenAI Images 格式，常用端点为 /v1/images/generations、/v1/images/edits、/v1/models。
- **/api**：本站前端接口，使用登录 Cookie，会随站点功能调整。

外部请求使用现有的 **NewAPI API 密钥**：请求头为 Authorization: Bearer sk-<NewAPI密钥>。站内密钥页面管理的也是 NewAPI 密钥，无需另行绑定 LFN 用户。LFN 会核验密钥并关联其所属用户的图包与个人 AFF；不要把管理员系统访问令牌当成图像 API 密钥。

## 站内功能

[图像工作台](/image)支持生成和图像工具；[创作者工作台](/studio)集成活动规则、投稿和审核状态；[我的账号](/profile)提供签到、奖励、兑换码与账户资料；[使用记录](/usage)用于查询调用。

公开文档由管理员在线编辑并发布，保存草稿不等于发布。发布后即时生效。`,
  "authentication-and-billing": `# 鉴权与计费

## 身份和扣费顺序

外部图像请求使用 Authorization: Bearer sk-<NewAPI密钥>，站内请求使用登录会话。有效 NewAPI 密钥按所属用户关联 LFN 钱包。

1. 优先使用图包 AFF。
2. 不足部分由个人 AFF 补足，单次请求可混合支付。
3. 两者仍不足时，按站点配置使用 NewAPI 余额结算。

参数校验先于扣费。失败或只完成部分图片时，按实际完成张数结算并退回对应来源的未使用额度。流式请求以最终图片事件为结算依据。

## 每日分段计费

以下是 LFN 的默认 AFF 计费策略；后台可调整，模型固定价格覆盖优先。NewAPI 余额支付沿用上游定价，请以工作台报价及实际流水为准。

按用户和模型系列统计成功图片，limit 合并到对应非 limit 系列，北京时间每天零点重置。批量跨过档位时逐张计算。A 表示计价公式估算的每张 Anlas。

| 系列 | 当日图片序号 | 每张人民币等价 |
| --- | --- | --- |
| V4.5 | 1–100 | A × 0.04 |
| V4.5 | 101–200 | 0.01 + A × 0.04 × 1.1 |
| V4.5 | 201 起 | 0.011 + A × 0.04 × 1.12 |
| V5 | 1–50 | 0.04 + A × 0.05 |
| V5 | 51–100 | (0.04 + A × 0.05) × 1.1 |
| V5 | 101–200 | (0.04 + A × 0.05) × 1.125 |
| V5 | 201 起 | (0.04 + A × 0.05) × 1.2 |

AFF 支持四位小数。当前图包为 NewAPI 显示 $200 兑换 200 AFF；按本站约定显示 $200 = ¥1，因此一个图包约 ¥1，1 AFF 约 ¥0.005。图包产品或兑换比例改变后，换算随之改变。这是站内余额的等价换算。

## 奖励与兑换

签到、邀请及创作活动按当前站点配置发放个人 AFF。LFN 兑换码增加个人 AFF；NewAPI 兑换码由 NewAPI 核验并增加 NewAPI 余额，二者不会重复入账。`,
  quickstart: `# 快速开始

## 在网页创作

登录后进入[图像工作台](/image)，选择模型、填写提示词并确认预计消耗。结果可在[图片历史](/history)查看，再到[创作者工作台](/studio)参与活动和投稿。投稿经审核通过后公开。

## 外部工具

使用你现有的 NewAPI API 密钥，服务地址填写 LFN 站点地址。先请求 GET /v1/models，确认密钥分组可用模型，再提交图片生成。

OpenAI 工具使用站点地址加 /v1；原生 NAI 工具使用站点地址与 /ai 系列端点，避免重复拼接 /ai。

NAI Launcher 4.3.0 的 multipart request.json、附带图片文件与 MessagePack 流式格式均受支持。流式参数使用 parameters.stream = "msgpack"，端点为 /ai/generate-image-stream。若客户端仍报错，保留发生时间与响应中的 X-LFN-Request-Id，参考[请求排查指南](/docs?slug=troubleshooting)。

兑换码可在[我的账号](/profile#profile-redeem)输入，NewAPI 码请保持原有大小写。`,
  "native-api-reference": `# NAI 原生接口参考

鉴权：Authorization: Bearer sk-<NewAPI密钥>。生成请求字段为 input、model、action、parameters；原生模型名示例 nai-diffusion-4-5-full、nai-diffusion-5-full。

## 生成与文件

POST /ai/generate-image 接受 JSON，以及 multipart/form-data。multipart 的 request 字段可为 JSON 文本或 request.json 文件；图像字段引用的文件名必须对应同次请求上传的文件。不要手工设置 multipart 边界。

action 支持 generate、img2img、infill；图生图提供 parameters.image，局部重绘还需同尺寸 mask。返回 ZIP 时解压即可获取 PNG。

## 流式

POST /ai/generate-image-stream 使用相同结构，并设置 parameters.stream 为 msgpack。每帧由四字节大端长度和 MessagePack 数据构成。event_type=final 的 image 是 PNG 二进制，samp_ix 标识样本；预览事件不代表最终图片。

客户端应按长度解帧，处理错误事件、连接取消和不完整尾帧。缺少最终图片时保留请求 ID 排查。上游只有 JSON 图片响应时，LFN 会转换为所需 ZIP 或 MessagePack 格式。

## 工具

- /ai/upscale：超分；参数与可用模型受上游能力限制。
- /ai/encode-vibe：参考图编码。
- /ai/augment-image：Director 工具，如去背景、线稿和情绪编辑。
- /ai/annotate-image：图像标注。

各模型能力不同，不支持的动作或参考图组合会返回 400；目录以 /v1/models 为准。`,
  "openai-compatible-api": `# OpenAI 兼容接口参考

鉴权：Authorization: Bearer sk-<NewAPI密钥>。

## 生成

POST /v1/images/generations，Content-Type: application/json。

\`\`\`json
{"model":"nai-v5-full","prompt":"1girl, masterpiece","size":"832x1216","n":1,"response_format":"b64_json"}
\`\`\`

响应图片位于 data[].b64_json，size 为宽x高。接口格式兼容不意味着支持所有 OpenAI 图像模型；模型取自 GET /v1/models。

## 编辑

POST /v1/images/edits 接受 JSON 或 multipart/form-data。JSON 的 image、mask 可用图片 data URL；multipart 使用二进制 image、mask 文件，其余字段作为文本字段。image 用于图生图，image 加 mask 用于局部重绘；需选择支持相应动作的模型。

GET /v1/models 返回当前模型目录，GET /v1/model 为兼容别名。账号分组、密钥模型限制和站点配置决定可用性。

响应中的 X-LFN-Payment-Source 表示 package、personal、mixed 或 newapi；X-LFN-Request-Id 用于关联排查。`,
  troubleshooting: `# 请求排查指南

记录发生时间（含时区）、模型、端点、HTTP 状态码和 X-LFN-Request-Id。不要公开密钥、Cookie 或完整鉴权头。

| 状态 | 检查内容 |
| --- | --- |
| 400 | 模型能力、尺寸、张数、mask 和文件引用是否一致 |
| 401 | 登录是否过期；NewAPI 密钥是否有效及 Bearer 格式 |
| 403 | 账号权限、风控策略或模型权限 |
| 413 | 请求体大小；缩小输入图或减少参考图 |
| 429 | 频率、上游并发或额度；按提示退避重试 |
| 502/503 | 上游连接、超时或不可用；保留请求 ID |

## NAI Launcher

确认服务地址没有重复 /ai，使用有效 NewAPI API 密钥。新版本使用 request.json 与 MessagePack 流式返回，最终图片来自 final 事件，不应把二进制响应当 JSON。无图片时先核对是否返回了最终帧和有效 PNG。

## 使用记录与 IP

[使用记录](/usage)可按模型、时间、状态和请求 ID 查询。Anlas 标明实际值、估算值或上游未报告；没有历史数据时无法恢复准确数值。

管理员在用户账本中可直接看到 IP 数量与脱敏证据，完整 IP 查询需填写原因并写入审计。记录包含 LFN 请求与保留期内已有的 NewAPI 登录、调用证据；历史上未记录的地址无法凭空补回。代理必须覆盖真实地址请求头并启用受信代理设置。默认保留期 30 天，可由服务器配置调整。

闲置登录会话默认每小时检查，7 天未使用自动撤销；保持登录不保证永久有效。管理端可配置周期与阈值或立即清理。

创作活动和投稿均在[创作者工作台](/studio#activities)，无需单独寻找活动页。`,
};
