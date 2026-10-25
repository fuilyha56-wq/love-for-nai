# 超分、Vibe、Director 与标签建议

下面都是外部图像 Key 接口，使用 `Authorization: Bearer <NewAPI图像密钥>`。先用[模型目录](/docs?slug=api-overview)与小图验证服务。工具端点存在不表示已配置对应原生上游；未配置时可能明确返回不支持。

## 独立 PNG 超分

端点为 `POST /ai/upscale`，JSON 中 `image` 为 PNG base64，可传带 PNG data URL 的内容；`model` 选择接口支持的 NAI 模型。当前输入上限为 3,145,728 像素，仅接受可解析 PNG，JPEG/WEBP 需先转 PNG。

```json
{
  "image": "替换为PNG的base64",
  "model": "nai-diffusion-5-curated",
  "declared_blur_sigma": 0
}
```

将请求保存为 `upscale.json`，调用并保存二进制响应：

```bash
curl --fail-with-body "$LFN_BASE_URL/ai/upscale" \
  -H "Authorization: Bearer $LFN_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @upscale.json --output upscale-response.bin
```

根据响应 Content-Type 判断是否为 ZIP 再解压，不要把错误 JSON 当图片。输入面积、模型和参数会先校验；普通独立超分不等于工作台分块超分。

## Vibe 编码

`POST /ai/encode-vibe` 提供 `image` 与模型相关参数，每次一张参考图；兼容 `images` 数组时也只允许长度为 1。编码输出不是生成图片，用于后续支持 Vibe 的原生生成请求。

使用步骤：选参考图 → 编码 → 保留编码结果 → 在模型要求的参考字段中传入 → 选择参考强度后生成。不同模型的参考格式有差异，复杂组合建议由 Launcher 或工作台构建，不要自行猜测编码字段。

## Director 图像工具

`POST /ai/augment-image` 要求 `image` 和 `req_type`，某些操作还需要提示词、尺寸等参数。Limit 模型不支持 Director。

| req_type | 用途 |
| --- | --- |
| declutter | 简化画面 |
| bg-removal | 背景移除 |
| lineart | 提取线稿 |
| sketch | 草图 |
| colorize | 上色 |
| emotion | 表情变换 |

示例请求骨架：

```json
{"req_type":"lineart","image":"替换为图片base64","width":832,"height":1216}
```

先读取 HTTP 状态与 Content-Type，再保存图像结果。工具可能走不同的已配置服务，实际可用动作以服务响应为准，复杂参数应参考当前客户端或上游支持情况。

## 图像标注

`POST /ai/annotate-image` 接收原生 JSON，例如 `image` 及服务支持的 `model`。该端点透传原生标注能力，模型如 `hed` 是否可用由当前上游决定，不是站内本地图片标签器的统一公共 API。

## 标签建议

`GET /ai/generate-image/suggest-tags?prompt=blue&model=nai-diffusion-3`，或向相同路径 POST `{"prompt":"blue","model":"nai-diffusion-3"}`。

这是生成提示词补全接口，返回标签建议；广场搜索匹配的是公开作品标签，两种检索来源和用途不同。

## 调用前检查

把 PNG 转成 base64 后放进 JSON，不要直接放本机文件路径。请求体总大小受 25 MiB 限制，base64 会增大体积。工具消耗与普通生成不同，以当前报价和流水为准；不要因图像生成成功就假设所有附加工具都可用。
