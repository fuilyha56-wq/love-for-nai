# OpenAI 图像兼容 API 与 Python 示例

鉴权统一使用 `Authorization: Bearer <NewAPI图像密钥>`。`https://lfn.example` 为占位根地址。这里实现图像接口，不表示 LfN 对外提供全部 OpenAI 聊天、Responses 或音频接口。

## 查询模型与第一次生成

先请求 `GET /v1/models`，使用当前密钥可用的模型。`GET /v1/model` 是兼容别名。

在 Bash、Linux 或 macOS：

```bash
export LFN_BASE_URL='https://lfn.example'
export LFN_API_KEY='sk-替换为你的密钥'
curl --fail-with-body "$LFN_BASE_URL/v1/models" \
  -H "Authorization: Bearer $LFN_API_KEY"

curl --fail-with-body "$LFN_BASE_URL/v1/images/generations" \
  -H "Authorization: Bearer $LFN_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"model":"nai-v5-full","prompt":"landscape, blue sky, mountains","size":"832x1216","n":1,"response_format":"b64_json"}' \
  --output result.json
```

在 PowerShell，先把相同 JSON 保存为 UTF-8 的 `request.json`：

```powershell
$env:LFN_BASE_URL = 'https://lfn.example'
$env:LFN_API_KEY = 'sk-替换为你的密钥'
curl.exe --fail-with-body "$env:LFN_BASE_URL/v1/images/generations" -H "Authorization: Bearer $env:LFN_API_KEY" -H 'Content-Type: application/json' --data-binary '@request.json' --output result.json
```

成功响应的图片位于 `data[].b64_json`，需要 base64 解码才能得到 PNG。示例明确请求 `b64_json`，不要假设一定返回可公开访问的图片 URL。

## Python 生成并保存图片

环境变量填写与上面相同的站点和密钥。安装 `requests` 后保存为 `generate.py`，运行 `python generate.py`；该操作会实际生成并计费。

```python
import base64
import os
from pathlib import Path
import requests

base = os.environ["LFN_BASE_URL"].rstrip("/")
key = os.environ["LFN_API_KEY"]
response = requests.post(
    base + "/v1/images/generations",
    headers={"Authorization": "Bearer " + key},
    json={"model": "nai-v5-full", "prompt": "landscape, blue sky, mountains",
          "size": "832x1216", "n": 1, "response_format": "b64_json"},
    timeout=(15, 300),
)
request_id = response.headers.get("X-LFN-Request-Id", "未返回")
if not response.ok:
    raise RuntimeError(f"HTTP {response.status_code}; 请求 ID: {request_id}")
for index, item in enumerate(response.json().get("data", [])):
    if not item.get("b64_json"):
        raise RuntimeError("响应没有 b64_json，请核对模型与返回格式")
    Path(f"lfn-{index + 1}.png").write_bytes(base64.b64decode(item["b64_json"]))
print("请求 ID:", request_id)
```

## 图生图与局部编辑

`POST /v1/images/edits` 接受 JSON 或 multipart。JSON 的 `image`、`mask` 可用 `data:image/png;base64,...`；只传源图用于图生图，提供同尺寸蒙版用于支持的局部重绘。NAI 蒙版白色区域表示重绘。

```bash
curl --fail-with-body "$LFN_BASE_URL/v1/images/edits" \
  -H "Authorization: Bearer $LFN_API_KEY" \
  -F 'model=nai-v4.5-full' \
  -F 'prompt=landscape, blue sky, flowers' \
  -F 'size=832x1216' \
  -F 'response_format=b64_json' \
  -F 'image=@source.png;type=image/png' \
  -F 'mask=@mask.png;type=image/png' \
  --output edit-result.json
```

图生图时省略 mask。必须选择支持该动作的模型，接口格式兼容并不保证所有模型支持编辑。multipart 的 Content-Type 交给 curl 或程序自动生成。

## 参数与结果处理

常用字段为 `model`、`prompt`、`size`、`n`、`response_format`；NAI 还有模型相关扩展参数，建议复杂角色和 Vibe 使用原生协议或 Launcher。通用 API Key 工具未必会保留扩展字段。

记录 `X-LFN-Request-Id` 与 `X-LFN-Payment-Source`，后者可为 `package`、`personal`、`mixed` 或 `newapi`。批量与重试由客户端管理；连接超时不能证明服务端未完成，不应无条件重复生成。
