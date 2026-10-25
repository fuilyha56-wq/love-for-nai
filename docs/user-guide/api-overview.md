# API 接入总览与端点速查

示例站点根地址使用 `https://lfn.example`，请换成你实际访问的 LfN 地址。API 路径按本项目实现说明，不表示当前站点已配置所有上游能力。

![外部 API Key 与站内登录会话分别访问 LfN 接口的流程示意](/docs/api-routing.svg)

## 应该选哪一种接口

| 使用场景 | 地址与格式 | 鉴权 |
| --- | --- | --- |
| Aaalice NAI Launcher、NAI 原生客户端 | 根地址，客户端再拼接 /ai 与 /user | Authorization: Bearer 图像密钥 |
| 支持 OpenAI Images 的工具 | Base URL 通常为根地址加 /v1 | Authorization: Bearer 图像密钥 |
| 自编图像脚本 | 按下表选择完整端点 | Authorization: Bearer 图像密钥 |
| 站内钱包、签到、历史、投稿、故事 | /api 系列 | 有效登录 Cookie |
| 广场和文档公开读取 | /api/gallery、/api/docs | 公开读取按接口实现开放 |
| 后台管理 | /api/admin 系列 | 管理员登录会话 |

这里的图像密钥是现有 NewAPI API Key，通常以 `sk-` 开头。外部工具可不登录 LfN 网页直接调用出图接口，但仍需有效密钥、模型权限与足够额度。

## 外部接口速查

| 方法与端点 | 用途 | 请求与响应 |
| --- | --- | --- |
| GET /v1/models | 查询可用模型 | 返回模型目录 JSON |
| GET /v1/model | 旧客户端模型目录别名 | 同类目录 JSON |
| POST /v1/images/generations | 文生图与支持的扩展操作 | JSON；常用 data[].b64_json |
| POST /v1/images/edits | 图生图、局部编辑 | JSON 或 multipart；图片 JSON |
| POST /ai/generate-image | NAI 原生生成、图生图、重绘 | JSON 或 request.json multipart；ZIP |
| POST /ai/generate-image-stream | NAI 流式生成 | MessagePack 长度分帧 |
| POST /ai/upscale | NAI 独立 PNG 超分 | JSON；按响应类型读取二进制 |
| POST /ai/encode-vibe | 编码单张参考图 | JSON；编码结果供后续请求使用 |
| POST /ai/augment-image | Director 图像工具 | JSON；原生图片响应 |
| POST /ai/annotate-image | 图像标注 | JSON；以工具返回格式为准 |
| GET /ai/generate-image/suggest-tags | 提示词标签建议 | prompt、model 查询参数 |
| POST /ai/generate-image/suggest-tags | 标签建议 | prompt、model JSON |
| GET /user/subscription | 第三方客户端订阅摘要 | LfN AFF 合成的兼容摘要 |
| GET /user/data | 第三方客户端数据摘要 | 包含上述 subscription 摘要 |

`/user/subscription` 也接受 POST。摘要来自本站额度，不是真实 NovelAI 账号订阅；不会开放上游账号资料、对象或账户明细，其他 `/user` 路径会被拒绝。

## 最小连通检查

```bash
export LFN_BASE_URL='https://lfn.example'
export LFN_API_KEY='sk-替换为你的图像密钥'
curl --fail-with-body "$LFN_BASE_URL/v1/models" \
  -H "Authorization: Bearer $LFN_API_KEY"
```

Windows PowerShell 使用 `curl.exe`，环境变量语法见[OpenAI 兼容示例](/docs?slug=openai-compatible-api)。先查模型目录，再使用其中实际可用的模型生成一张小图，最后接入批量、参考图与流式。

## 地址与响应的常见误区

工具如果自行追加 `/v1/images/generations`，Base URL 按工具约定填写根地址或根地址加 `/v1`，检查最终请求避免出现 `/v1/v1`。NAI Launcher 的第三方 API 站点填根地址，不填 `/ai/generate-image`。

读取响应前检查 HTTP 状态与 Content-Type。生成通常有实际消耗，不要用生成端点做高频健康检查。网络中断后也不要立即重复付费请求；先确认是否已完成及账单情况。

支持跨域的外部图像路由允许 Bearer 请求；站内会话接口不因此对任意网站开放。服务端脚本不受浏览器 CORS 限制。
