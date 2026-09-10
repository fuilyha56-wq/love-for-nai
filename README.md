# Love for NAI

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

需要 Node.js 20.18.1 或更高版本。

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

## 验证

```bash
npm run lint
npm test
npm run build
docker compose ps
```

健康检查：`GET /api/health`。

## 许可证

本项目使用 [GNU Affero General Public License v3.0](LICENSE)。通过网络提供修改版本时，必须向使用者提供对应源代码，详见许可证第 13 节。
