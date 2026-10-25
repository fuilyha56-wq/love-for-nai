# NAI 原生生成与 MessagePack 流式

所有外部请求使用 NewAPI 图像密钥的 Bearer 请求头。根地址示例为 `https://lfn.example`；原生模型名与 `/v1` 别名区分填写。

## 非流式 JSON 文生图

保存下面的 JSON 为 `native-request.json`：

```json
{
  "input": "landscape, blue sky, mountains",
  "model": "nai-diffusion-5-full",
  "action": "generate",
  "parameters": {
    "width": 832,
    "height": 1216,
    "steps": 28,
    "scale": 5,
    "sampler": "k_euler_ancestral",
    "noise_schedule": "karras",
    "n_samples": 1
  }
}
```

```bash
curl --fail-with-body "$LFN_BASE_URL/ai/generate-image" \
  -H "Authorization: Bearer $LFN_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @native-request.json --output images.zip
```

成功时按 ZIP 解压得到图片。先检查 HTTP 状态与 Content-Type，错误 JSON 保存成 `.zip` 后无法解压。PowerShell 使用 `curl.exe` 与 `$env:LFN_BASE_URL`、`$env:LFN_API_KEY`。

## 图生图、局部重绘与文件上传

`action` 支持 `generate`、`img2img`、`infill`。图生图在 parameters 提供 `image` 和相应强度；局部重绘还要提供与源图同尺寸的 `mask`，使用支持重绘的模型。具体模型能力见[限制说明](/docs?slug=models-and-limits)。

使用 multipart 时，`request` 字段可为 JSON 文本或 `request.json` 文件。JSON 中的图像字段可以引用同次上传的文件名，引用与文件名必须一致。不要把本机绝对路径当作服务器可读取的文件地址。

```bash
curl --fail-with-body "$LFN_BASE_URL/ai/generate-image" \
  -H "Authorization: Bearer $LFN_API_KEY" \
  -F 'request=@request.json;type=application/json' \
  -F 'image=@source.png;filename=source.png;type=image/png' \
  --output images.zip
```

这个示例要求 `request.json` 使用 `action=img2img` 并让 `parameters.image` 引用 `source.png`，同时提供正确的尺寸和模型字段。curl 自动处理 multipart 边界。

## 流式生成

`POST /ai/generate-image-stream` 使用相同请求结构，添加 `parameters.stream="msgpack"`。返回的是二进制长度分帧流，不是 SSE 文本，也不是逐行 JSON。

每帧由四字节大端无符号长度和随后对应长度的 MessagePack 数据组成。客户端应保留未完成缓冲，不能假设一次网络读取刚好等于一帧。

```python
# pip install msgpack；buffer 在每次网络读取之间保留
import msgpack
buffer = bytearray()
for chunk in response.iter_content(chunk_size=65536):
    buffer.extend(chunk)
    while len(buffer) >= 4:
        length = int.from_bytes(buffer[:4], "big")
        if length > 64 * 1024 * 1024:
            raise RuntimeError("异常帧长度")
        if len(buffer) < 4 + length:
            break
        event = msgpack.unpackb(bytes(buffer[4:4 + length]), raw=False)
        del buffer[:4 + length]
        # event_type=final 时才保存 image；samp_ix 是样本索引。
        handle_event(event)
if buffer:
    raise RuntimeError("连接结束时留下不完整帧")
```

以上为解帧逻辑，需要程序自行实现 `handle_event`、请求发送、错误事件处理和输出保存。最终事件 `event_type=final` 中的 `image` 是 PNG 二进制，`samp_ix` 区分样本。没有 final 图片时不能把预览帧当作成功。

## 代理与排错

网关或反向代理必须允许长连接并正确转发二进制流，避免缓冲整段响应。普通生成成功但流式无图时，先检查客户端协议、请求参数与代理超时，再提供时间、模型和 `X-LFN-Request-Id` 排查。

请求是否计入每日图片与具体扣费由成功结果和账单决定，预览事件不代表多生成一张。客户端取消、断线和超时应按[请求排查指南](/docs?slug=troubleshooting)处理。
