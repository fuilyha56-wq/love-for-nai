# 创建密钥与选择外部工具

## 准备图像 API Key

登录后从[设置](/settings)的模型密钥入口或[API 密钥页](/keys)管理密钥；NewAPI 账号模式下管理的是 NewAPI API Key。创建一个便于辨认的名称，选择可用分组、额度、过期时间及必要的模型限制，保存后复制完整密钥。

已有有效 NewAPI 图像密钥可以继续使用，无需再绑定一遍 LfN 用户。LfN 核验密钥所属用户后关联该用户的图包与个人 AFF。若站点使用本地账号或没有启用上游密钥管理，请按站点实际提供方式获取外部密钥，不保证本地账号自动拥有 NewAPI Key。

请求头使用 `Authorization: Bearer sk-...`。通常工具的 API Key 输入框只填密钥本身，不填 `Bearer ` 前缀；只有手写请求头时才加前缀。不要把 API Key 放到 URL 查询参数、公开截图或共享项目里。

## 推荐工具

| 工具 | 推荐用途 | LfN 接入方式 |
| --- | --- | --- |
| Aaalice NAI Launcher | NAI 创作、角色、参考图、重绘和本地图库 | 第三方站点模式，根地址与图像 API Token |
| curl | 最小连通验证、下载 ZIP、复现错误 | 完整端点加 Bearer 请求头 |
| Postman | 图形化请求、JSON 与 multipart 调试 | Bearer Token 鉴权，手工选择方法与端点 |
| Bruno | 本地保存接口集合、参数与调用示例 | 配置地址、Bearer 头和请求体 |
| 自编 Python 程序 | 批量编排、图片解码和结果保存 | /v1 JSON 或 /ai 原生协议 |

首选项目：[Aaalice233/Aaalice_NAI_Launcher](https://github.com/Aaalice233/Aaalice_NAI_Launcher)，[下载发行版](https://github.com/Aaalice233/Aaalice_NAI_Launcher/releases)。它是独立社区客户端，支持 Windows、macOS 与 Android；LfN 接入步骤以[专门教程](/docs?slug=launcher-integration)为准。

[Postman Bearer Token 官方说明](https://learning.postman.com/docs/use/send-requests/authorization/authorization-types/)；[Bruno 官方项目](https://www.usebruno.com/)。这里推荐的是使用这些工具发送标准 HTTP 请求，不代表它们内置了 LfN 钱包或签到插件。

## Postman / Bruno 调试步骤

1. 新建环境变量 `base_url=https://lfn.example`、`api_key=你的密钥`，把真实密钥保存在私有环境中。
2. 创建 `GET {{base_url}}/v1/models`，鉴权选择 Bearer Token，Token 引用 `{{api_key}}`。
3. 成功后创建 `POST {{base_url}}/v1/images/generations`，Body 选择 JSON，使用兼容 API 教程的最小请求。
4. 读取 HTTP 状态、响应中的 `data[].b64_json` 和请求 ID。把 base64 解码保存为 PNG。
5. 原生接口返回 ZIP 时使用“保存响应”下载文件；MessagePack 流需要专门的解帧程序，普通 JSON 查看器不能直接预览图片。

可下载[不含真实凭据的 Postman 请求集合](/docs/lfn-api.postman_collection.json)。导入后填写站点和密钥；只有手动发送生成请求才会调用出图。

## 哪些客户端不能直接使用

仅支持聊天补全、固定 OpenAI 官方域名、无法自定义模型或只接受图片 URL 的工具，不一定支持这里的图像响应。NAI 专有参数和 MessagePack 不会因为工具支持“OpenAI 兼容”就自动可用。

Krita、ComfyUI 可通过 Launcher 自身桥接或相应工作流使用，但通用本地模型节点不会自动转成 LfN 云端请求。接入插件必须明确支持目标 HTTP 路径、鉴权和返回格式，再根据作者文档配置。

API Key 不等于网页登录，也不赋予签到、钱包管理或后台权限；这些场景见[账号与自动化](/docs?slug=account-and-check-in)。
