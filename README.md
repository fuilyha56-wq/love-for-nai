# Love for NAI

Love for NAI（LFN）是使用现有 NewAPI 账号、余额和模型权限的中文 NovelAI 图片工作台。

当前版本是首个可运行预览：已包含响应式图片工作台、体验模式、NewAPI 用户名密码登录代理、签名 `HttpOnly` 会话以及登录后的余额和分组读取。真实生图、历史、AFF 和管理后台会在后续里程碑接入；当前生成按钮不会发送上游请求或扣费。

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

访问 `http://localhost:3000`。

## Docker 部署

```bash
cp .env.example .env
docker compose up -d --build
```

默认暴露 `41800` 端口，可通过 `LFN_PORT` 调整。容器通过 `host.docker.internal` 访问宿主机上的 NewAPI；Linux Compose 已配置 `host-gateway`。

必须将 `LFN_SESSION_SECRET` 替换为至少 32 字节的随机值。LFN 不保存用户密码，NewAPI 上游会话仅保存在签名的 `HttpOnly` Cookie 中。

## 验证

```bash
npm run lint
npm run build
docker compose ps
```

健康检查：`GET /api/health`。

## 许可证

本项目使用 [GNU Affero General Public License v3.0](LICENSE)。通过网络提供修改版本时，必须向使用者提供对应源代码，详见许可证第 13 节。
