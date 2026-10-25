# Aaalice NAI Launcher 接入教程

推荐项目：[Aaalice233/Aaalice_NAI_Launcher](https://github.com/Aaalice233/Aaalice_NAI_Launcher)。从[项目 Releases](https://github.com/Aaalice233/Aaalice_NAI_Launcher/releases)下载适合 Windows、macOS 或 Android 的版本，安装步骤与校验文件以原项目发布说明为准。

以下为“第三方站点”模式的 LfN 配置说明。界面文案可能随客户端版本变化；不要在 NovelAI 官方账号密码登录页填写 LfN 密钥。

![Launcher 第三方站点配置的字段示意，非客户端实际截图](/docs/launcher-setup.svg)

## 1. 获取正确凭据

准备当前 LfN 站点根地址和有效 NewAPI 图像 API Key，例如 `https://lfn.example` 与 `sk-...`。客户端使用 API Token Bearer 鉴权，不要求浏览器保持登录；它也不会因此获得你的 LfN 网页 Cookie。

## 2. 在第三方站点模式填写

1. 打开 Launcher 的登录方式切换，选择“第三方站点”。
2. “第三方 API 站点”填 LfN 根地址，如 `https://lfn.example`。若管理员明确提供子路径部署入口，使用该入口。
3. 昵称是本地便于区分的名称，可以填 `LfN`。
4. “API Token”填完整 NewAPI 图像密钥，保留 `sk-`，不手动添加 `Bearer `。
5. 保存或连接。客户端会用订阅摘要等兼容能力检查服务；连接失败时按下面步骤排查。

如版本提供单独“图像 API 地址”，LfN 的主地址与图像地址通常使用同一根地址。客户端自行追加 `/user/subscription` 和 `/ai/generate-image`，因此不要预先填入 `/ai`、`/v1` 或完整生成路径。

## 3. 第一次生成

选择站点实际开放的 NAI 模型。原生名称示例为 `nai-diffusion-5-full`、`nai-diffusion-4-5-full`；能否使用由模型分组和站点策略决定。

先输入简单提示词，使用一张 832×1216 图片和默认参数测试。成功后再添加角色、参考图、局部重绘与队列。客户端自身估算的 Anlas 与 LfN 的 AFF、分档或 NewAPI 账单不是同一个最终结算值。

## 流式与文件兼容

LfN 接受 JSON 和 multipart：`request` 可为 JSON 字符串或 `request.json` 文件，图片引用需与同次上传的文件名一致。不要手工拼写 multipart 边界。

流式使用 `/ai/generate-image-stream`，`parameters.stream` 为 `msgpack`。最终图片在 `event_type=final` 的二进制 `image` 字段，`samp_ix` 表示样本索引；预览事件不是最终结果。出现无图问题时先用非流式生成排查，再检查流式兼容与代理缓冲。

## 余额显示的含义

`GET /user/subscription` 使用有效图像 Key 读取 LfN 合成摘要，`trainingStepsLeft.fixedTrainingStepsLeft` 为个人和图包 AFF 总额向下取整，`tier=0`。这是兼容客户端所需的余额展示，不表示你购买了 NovelAI 订阅，也不是官方 Anlas 余额。

精确小数余额、每日计数和支付来源请到 LfN[我的账号](/profile)及[使用记录](/usage)查看。`/user/data` 仅提供本站摘要，其他官方账户路径不会转发上游隐私资料。

## 连接失败时

- 401：检查 Token 是否完整、过期、停用，是否误用系统访问令牌。
- 404：检查最终路径是否重复了 `/ai`、`/v1` 或站点子路径。
- 403：检查模型权限、账号状态或客户端是否请求未开放的账户接口。
- 400：检查模型动作、尺寸、步数和图片格式；先撤掉参考图测试。
- 只显示进度无最终图：记录发生时间和 `X-LFN-Request-Id`，确认收到了 final 帧。

本教程依据项目第三方站点模式与 LfN 路由核对，不保证所有历史客户端或插件版本均兼容。更新客户端后仍有问题，可提交去掉密钥和 Cookie 的错误信息。
