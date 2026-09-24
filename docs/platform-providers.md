# LFN 平台能力拆分

LFN 不再把 NewAPI 和 NovelAI Gateway 当成唯一运行方式。站点本身负责工作台、账号会话、公告、创作额度和管理模块；上游只是可替换的能力。

## 能力面

| 能力 | 默认 | 可替换为 |
|---|---|---|
| 账号 / 登录 | NewAPI | `LFN_AUTH_PROVIDER=local` 本地账号 |
| 图像生成 | NewAPI `/v1/images` | 管理端启用的图像端点：Gateway 或任意 OpenAI 兼容接口 |
| 上游余额 / 密钥 / 用量 | NewAPI | 关闭，仅保留 LFN 创作额度 |
| 图包购买 | NewAPI 扣余额 + Gateway | 未配置时自动关闭 |
| 管理中心 | NewAPI 用户 + 本地公告 / 额度 / 图库 | 本地用户、公告、额度账本、图库下架、邀请记录、平台配置 |

## 环境变量

```
LFN_AUTH_PROVIDER=newapi|local
NEWAPI_BASE_URL=...
LFN_AFF_GATEWAY_URL=...
LFN_AFF_GATEWAY_TOKEN=...
LFN_IMAGE_PROVIDER_URL=...
LFN_IMAGE_PROVIDER_TOKEN=...
```

`GET /api/health` 和 `GET /api/admin` 会返回当前 `capabilities` 与可扩展管理模块，前端按能力显示，不再写死 NewAPI / Gateway 文案。管理中心「平台配置」把这些值写进 `{LFN_DATA_DIR}/platform/config.json`，覆盖环境变量并立即生效；密钥留脱敏值表示不改。

## 外部批量配置

MCP、部署脚本或其他外部工具可通过一次请求顺序提交多项平台配置：

```http
POST /api/admin/platform/batch
Authorization: Bearer <LFN_ADMIN_TOKEN>
Content-Type: application/json
```

```json
{
	"operations": [
		{
			"id": "site",
			"action": "settings.update",
			"params": {
				"publicUrl": "https://lfn.example.com",
				"naiImageApiUrl": "https://gateway.example.com",
				"naiImageApiToken": "<gateway-token>"
			}
		},
		{
			"id": "image-endpoint",
			"action": "endpoint.upsert",
			"params": {
				"id": "primary-image",
				"type": "image",
				"adapterType": "gateway",
				"name": "Primary Gateway",
				"enabled": true,
				"priority": 100,
				"config": {
					"baseUrl": "https://gateway.example.com",
					"token": "<gateway-token>"
				}
			}
		},
		{
			"id": "billing",
			"action": "billing.replace",
			"params": {
				"modelBilling": {
					"nai-v5-full": { "mode": "fixed", "fixedCost": 2 }
				}
			}
		}
	]
}
```

支持的 `action`：

- `settings.update`：更新站点设置；`registerGroup` 始终固定为 `ikun`。
- `endpoint.upsert`：创建端点，或携带 `params.id` 更新端点。
- `endpoint.delete`：删除 `params.id` 指定的端点。
- `billing.replace`：替换模型计费配置。

服务端严格按数组顺序执行。全部成功返回 `200`；任一操作失败返回 `207 Multi-Status`，失败前的操作保持已提交，失败项返回完整 `error.name` 与 `error.message`，其后的操作统一标记为 `not_executed`。单批最多 50 项。站内管理员会话也可调用该接口，但外部工具应使用 `LFN_ADMIN_TOKEN`。

所有模型令牌和外部模型执行入口只允许 `ikun` 分组；图像、故事与标签助手共享进程级 FIFO 并发门，最多同时执行 2 个上游模型请求。该限制不影响价格、模型目录等只读接口。

## 无 NewAPI 最小部署

1. `LFN_AUTH_PROVIDER=local`
2. 配置 `LFN_IMAGE_PROVIDER_URL` + `LFN_IMAGE_PROVIDER_TOKEN`（OpenAI 兼容图像接口）
3. 不配 Gateway 时，生成走创作额度或直接走该图像上游
4. 管理中心可管理本地用户、公告、额度账本、图库、邀请记录，以及平台配置里的上游和环境项

现有生产站保持 `LFN_AUTH_PROVIDER=newapi`，行为不变。
