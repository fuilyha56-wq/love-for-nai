# Love for NAI

> 验证文件说明：文中的单元测试、浏览器检查和审计脚本保留在开发者本机，按发布要求不包含在当前 GitHub 文件中。干净检出可运行 `npm run lint` 和 `npm run build`；历史测试路径与命令仅供拥有本机验证文件的开发环境参考。


Love for NAI（LFN）是使用现有 NewAPI 账号、余额和模型权限的中文 NovelAI 图片工作台。

当前版本包含中文图片工作台、文生图、图生图、蒙版重绘、参考图和 Director Tools、Danbooru 标签检索、LLM 标签助手、用户图片历史，以及 NewAPI 资料、余额、日志、模型和密钥管理。网页登录使用签名 `HttpOnly` 会话；图片调用经 NewAPI 鉴权和计费，不修改 NewAPI，也不会将 Gateway 密码发送给浏览器。

## 兼容 API

LFN 同时提供 OpenAI 与 NovelAI 客户端兼容入口。所有外部请求必须携带调用方自己的 NewAPI Key：

```http
Authorization: Bearer sk-...
```

OpenAI 路径：

- `GET /v1/models`、`GET /v1/model`：返回当前 Key 可用的 `nai-*` 模型。
- `POST /v1/images/generations`：OpenAI JSON 请求和响应。
- `POST /v1/images/edits`：支持 NewAPI 接受的 JSON 或 multipart 请求。

NovelAI 路径：

- `POST /ai/generate-image`：接受 NovelAI 原生生成 JSON。配置 Gateway 后原样转发 ZIP / Msgpack Stream；否则转换为 OpenAI 兼容请求并打包成 ZIP。
- `POST /ai/generate-image-stream`：官方流式入口。请求体 `parameters.stream=msgpack`，响应为带 4 字节长度前缀的 MessagePack 事件（`intermediate` / `final`）。LFN 工作台会把中间帧刷新到同一画布，效果对齐 NovelAI 官网。
- `GET|POST /ai/generate-image/suggest-tags`：标签建议。
- `POST /ai/augment-image`：支持 `declutter`、`bg-removal`、`lineart`、`sketch`、`colorize`、`emotion`。
- `POST /ai/encode-vibe`、`POST /ai/upscale`、`POST /ai/annotate-image`：配置 Gateway 后由服务端携带 Gateway Token 转发；未配置或本地额度不足且没有 NewAPI 计费映射时返回 `409`。
- `GET /user/subscription`、`GET /user/account`、`GET /user/objects`：对普通用户 Token 一律返回 `403`。账户信息只能由 LFN 服务端使用 Gateway Token 向网关读取。

OpenAI 示例：

```bash
curl -X POST http://localhost:3000/v1/images/generations \
	-H "Authorization: Bearer sk-your-newapi-key" \
	-H "Content-Type: application/json" \
	-d '{"model":"nai-v4.5-full","prompt":"1girl","size":"832x1216","response_format":"b64_json"}'
```

NovelAI 示例：

```bash
curl -X POST http://localhost:3000/ai/generate-image \
	-H "Authorization: Bearer sk-your-newapi-key" \
	-H "Content-Type: application/json" \
	-d '{"input":"1girl","model":"nai-diffusion-4-5-full","action":"generate","parameters":{"width":832,"height":1216,"n_samples":1,"steps":28,"scale":5,"sampler":"k_euler_ancestral","noise_schedule":"native"}}' \
	--output images.zip
```

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

访问 `http://localhost:3000`。

需要 Node.js 22.13.0 或更高版本（与 `package.json` 的 `engines` 要求一致）。

## 登录与上传入口注意事项

- 支持 NewAPI 的扁平及 `data.user` 账号响应，以及个人访问令牌和新版登录令牌；凭据必须通过上游身份校验，不能使用模型 API Key 冒充登录令牌。
- 新版 NewAPI 的短期登录 token 在到期前通过正式 refresh 接口续期；轮换凭据加密保存在数据卷的 `auth-refresh` 目录，不放在公共资源目录。429、网络超时和临时网关错误保留本地已验证身份，按 `Retry-After`（30–900 秒，默认 60 秒）退避，避免刷新页面触发续期风暴或 SSR 500；上游余额暂不可读，不伪造权限或余额，明确的 401/403 仍要求重新登录。当前使用单应用进程的会话刷新锁，多副本部署须增加共享分布式锁。
- HTTPS 登录保留 `Secure` Cookie。确需兼容 HTTP IP 登录时，受信反代应覆盖 `X-Forwarded-Proto`，并开启 `LFN_TRUST_PROXY`；应用端口只能由受信反代访问。HTTP 不加密凭据，仅用于明确接受风险的环境，不能全局关闭 HTTPS 的安全属性。
- 广场参赛图和校验原图各最多 20 MiB，合并 multipart 请求最多 42 MiB；IP 与 HTTPS 两层代理都应设置 `client_max_body_size 42m`。原图仅管理员可见，部分公开提示词仍须通过来源删减校验。HTML/空响应会显示明确的 HTTP 错误，不应显示 JSON 解析异常。
- 自定义模型出站仍校验并固定公网 DNS 地址，兼容 Node.js 的多地址查询回调。助手连接失败不自动重试可能已计费的请求；排查时仅记录目标主机和错误码，不记录密钥或私有提示词。账号续期和模型密钥读取会透传受信代理核实后的客户端 IP，避免所有用户共享 LFN 出口的限流桶；上游空 429 会显示明确的限流提示。
- 大图无元数据时的兼容扫描按块解码，避免逐字节拼接字符串耗尽 Node 堆内存。上传验收应包含缺少元数据的接近上限图片，不只测试携带 NAI 参数的小图。

### 多用户账号服务限流

LFN 应把受信入口核实的客户端 IP 传给 NewAPI；NewAPI 的 `TRUSTED_PROXIES` 必须仅包含实际 LFN 出口与必要本地反代，不能信任全公网。否则所有 LFN 用户会共享服务器出口的登录/刷新/读取 Key 限流桶。优先修复来源识别，不能用关闭限流或随意伪造 IP 解决。

模型与价格目录在同一凭据作用域内短暂缓存 30 秒；账号余额仅合并同时发起的请求。相同账号、凭据和 Key ID 的密钥明文读取可跨助手模型复用，429 遵循 `Retry-After` 冷却，并返回剩余等待时间，切换模型不会重新延长冷却。上游明确拒绝鉴权时失效同凭据目录缓存。权限、余额和计费仍以上游最终响应为准，不跨用户复用凭据。手机和电脑登录均显示冷却倒计时，服务繁忙不再误报凭据失效。

钱包、计价和用量接口同样保留结构化 429，不转换成 500/502；用量模型发现被限流时不再额外发起通配日志查询。只查看本站 AFF／图包记录不依赖 NewAPI 可用性，混合查询上游失败会明确提示仅展示本站记录。

助手选择“自动（账号默认）”时，优先复用账号默认分组内的可用 Key，不能被另一个分组较新的 Key 或旧的 `lfn-assistant` Key 抢占。默认分组不支持模型或没有可用 Key 时，仍复用其他已授权兼容分组的 Key，避免重复创建；明确选择分组则严格使用该分组。模型调用失败不自动切分组或重复发送可能已计费的请求。

助手工具预算耗尽、输出截断或运行中断后，手机和电脑均可点击“继续未完成任务”：复用原任务 ID、模型上下文、已完成工具结果及用量记录，从未完成步骤续跑，不把原需求重新加入队列。客户端等待超时只停止等待，不取消后台；用户主动停止后须等旧执行退出，才能继续。目标 Agent 保留原目标 ID 和已完成生图轮数。显式“重试/编辑重发”仍是新任务。

续跑检查点仅保存在当前服务进程内，停止后保留 10 分钟，最多 100 个任务；重启、清空/删除会话或检查点到期后明确提示不能续跑，不偷偷新开任务。继续前重新验证账号和原模型来源权限，不能跨用户或会话续跑；上游明确内容拒绝不提供继续。已收到的部分文本可续写，未收到的模型内部推理无法还原；中断时未完成的只读工具可能重新执行，已保存结果的工具不会重复执行。

批量投稿失败会保留失败及未发送项，不再把已确认成功项重新提交；网络中断导致结果不明确时，先检查“我的投稿”。管理员审核和删除提供进行中锁及错误反馈。

完整离线词库应包含 `catalog_tags_suggest(name COLLATE NOCASE, source, post_count DESC, key)` 覆盖索引。前缀检索先在索引中排名再读取长介绍，已完成索引的组合词全文搜索使用 FTS，避免同步扫描大体积词库阻塞登录和页面响应。旧词库升级只新增索引，不删除标签、介绍或源记录；可恢复导入中的词库仍兼容原查询。

## Docker 部署

```bash
cp .env.example .env
docker compose up -d --build
```

默认暴露 `21142` 端口，可通过 `LFN_PORT` 调整。容器通过 `host.docker.internal` 访问宿主机上的 NewAPI；Linux Compose 已配置 `host-gateway`。

如果服务器不适合现场构建，可在构建机执行 `docker build -t love-for-nai:<版本> .` 和 `docker save`，导入服务器后设置 `LFN_IMAGE=love-for-nai:<版本>`，再使用 `docker compose -f compose.prod.yml up -d`。

AFF 与 NewAPI 余额是两种独立支付方式。同时配置 `LFN_AFF_GATEWAY_URL`（Gateway 入口）与 `LFN_AFF_GATEWAY_TOKEN`（Gateway 的 `GATEWAY_AUTH_TOKEN` / `GATEWAY_PASSWORD`）后，AFF 足够的图像生成会直连 Gateway，由平台 NovelAI 凭据承担上游成本，不再经过 NewAPI，也不会扣用户 NewAPI 余额；AFF 不足时会自动改用登录用户的 NewAPI 余额并按 NewAPI 计费。两者未配置时，所有生成只使用 NewAPI 余额且不扣 AFF。浏览器不会持有 Gateway Token。

可选双端点：

- `LFN_NAI_API_URL` / `LFN_NAI_API_TOKEN`：第三方 API 站点，默认账号与图像入口。
- `LFN_NAI_IMAGE_API_URL` / `LFN_NAI_IMAGE_API_TOKEN`：图像 API 站点。填写后 `/ai/generate-image`、`/ai/encode-vibe` 等走该地址。

Danbooru 或 Wikipedia 无法直连时设置 `LFN_OUTBOUND_PROXY`。只有在受信反向代理会覆盖客户端传入的 `X-Forwarded-For` 时，才可设置 `LFN_TRUST_PROXY=true`；否则标签搜索使用站点级安全限流。

必须将 `LFN_SESSION_SECRET` 替换为至少 32 字节的随机值。LFN 不保存用户密码，NewAPI 上游会话仅保存在 AES-GCM 加密的 `HttpOnly` Cookie 中。使用 HTTPS 域名后应将 `LFN_COOKIE_SECURE` 改为 `true`；纯 HTTP IP 预览保持为 `false`。

### 图片 V2 来源签名

LFN 使用 Ed25519 签署来源声明，并用 SHA-256 绑定原始图片字节。新密钥保存在服务端数据卷的 `watermark-v2-keys.json`，旧 `watermark-keys.json` 用于验证历史 RSA 签名。升级和备份时应保留这两个文件，多实例部署应使用同一套持久化签名密钥。

Gateway 对接时先部署 LFN 的 V2 签名服务。将 Gateway 的 `LFN_WATERMARK_SIGNER_URL` 指向 LFN 私有入口的 `/api/internal/image-watermark`，为两端配置同一个独立随机令牌（例如 `openssl rand -hex 32`）。优先以只读文件挂载令牌并设置 `LFN_WATERMARK_SIGNER_TOKEN_FILE` 为容器内路径，也可通过服务端的 `LFN_WATERMARK_SIGNER_TOKEN` 注入。使用受信的内部网络或 HTTPS 连接。公开反代会拦截内部签名路径，公开校验使用 `/api/images/verify-watermark`。

## 验证

```bash
npm run lint
# npm test 仅适用于保留本机验证文件的开发环境
npm run build
docker compose ps
```

健康检查：`GET /api/health`。

## 许可证

本项目使用 [GNU Affero General Public License v3.0](LICENSE)。通过网络提供修改版本时，必须向使用者提供对应源代码，详见许可证第 13 节。
