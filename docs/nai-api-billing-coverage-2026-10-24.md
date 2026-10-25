# LFN API 计费覆盖核查（2026-10-24）

常规 API 原本已经共用新版 AFF 计费；本次补齐特殊请求参数和 Vibe 编码响应的遗漏。费率不变：1 AFF = ¥0.005，普通 Anlas = ¥0.02，V5 Anlas = ¥0.025（1.25 倍）。

## 入口与钱包

| API 入口 | 计费与结算 |
|---|---|
| `/v1/images/generations` | 共用 `trySpendImageCredits`，覆盖文生图、图生图、参考图及兼容工具操作 |
| `/v1/images/edits` | JSON、multipart 均按实际编辑强度计费 |
| `/ai/generate-image` | 原生 JSON、multipart 请求；原生通道或兼容通道均共用新版计费 |
| `/ai/generate-image-stream` | 原生流式接口；成功输出计费，失败或部分输出按原预扣金额退款 |
| `/ai/upscale` | 按输入 PNG 真实面积计费，不收生图基础费，不增加每日生图计数 |
| `/ai/augment-image` | Director 固定 Anlas 工具费，不收生图基础费，不增加每日生图计数 |
| `/ai/encode-vibe` | 单张图片编码 2 Anlas；编码结果直接返回，成功结算，空结果或上游失败退款 |

站内 API Key 优先使用所属用户的图包/个人 AFF，沿用本站每日阶梯；余额不足且策略允许时转 NewAPI 真实生成，由 NewAPI 单独结算，LFN 不再扣 AFF，也不增加本地每日计数。NewAPI 仍按已批准的首档价格，不实现每日阶梯。非 NAI 模型保持原有 NewAPI 计费路径。

只读核查确认：线上 `platform/config.json` 没有 NAI 的 `modelBilling.fixed` 覆盖；八条 NewAPI 动态表达式和六个 Limit 固定价均是已批准的新配置。

## 修复与对照

以下为 V5 High，除超分、编码和 Vibe 外均为 2048×1536、28 步、1 张、每日首档。这里的“修复前”仅指触发所述特殊参数情况，不代表常规数值参数也曾使用旧费率。

| 场景 | 修复前 | 修复后 | 修复后人民币 |
|---|---|---:|---:|
| 普通文生图 | 已是 455 AFF | 455 AFF | ¥2.275 |
| 图生图默认强度 0.7 | 已是 320 AFF | 320 AFF | ¥1.60 |
| 图生图 `strength="0.55"` 字符串 | 按默认 0.7 预扣 320 AFF | 255 AFF | ¥1.275 |
| 编辑 `inpaintImg2ImgStrength="0.55"` 字符串（含 multipart） | 按默认 1 预扣 455 AFF | 255 AFF | ¥1.275 |
| `uncond_scale="0.5"` 字符串 | 计费忽略该值，预扣 455 AFF | 230 AFF | ¥1.15 |
| 真实 2048×1536 PNG 通过兼容接口超分，申报 1024×1024 | 按申报尺寸收 5 AFF | 按真实面积收 20 AFF | ¥0.10 |
| `/ai/encode-vibe` 返回正常二进制编码 | 当作图片响应检查，误报失败并退款 | 返回编码、结算 10 AFF | ¥0.05 |
| 五张缓存 Vibe，1024×1024、23 步 | 已是 145 AFF | 145 AFF | ¥0.725 |

请求头 `X-NovelAI-Extra-Params`、`X-Steps`、`X-N-Samples`、`X-NovelAI-Operation` 等现在先归一化，再供报价和实际转发共同使用。旧的直连 AFF 通道会丢弃这些头，而 NewAPI 透明回退可能继续保留，造成不同钱包执行参数不一致；修复后统一执行请求指定的有效参数。Limit 的面积、步数和免费范围检查在覆盖参数生效后执行。

配置图像适配器的 API 路径同步保留输入图、mask、编辑强度、参考图等参数。单张工具端点拒绝不受支持的批量张数；Vibe 编码多图请求直接返回 400。

## 公式

生图首档 AFF = 每张基础费 + 官方 Anlas × 销售人民币单价 ÷ 0.005。基础费：V4.5 为 1 AFF、V5 High 为 5 AFF、Medium 为 1 AFF；独立工具基础费为 0。

LFN 生图每日阶梯继续使用线上持久化策略。High 与 Medium 共用计数：1–75 张 α=β=1；76–125 张 α=β=1.1；126–200 张 α=β=1.15；201 张起 α=β=1.2。当前各档的基础人民币差额为 0，因此单张 AFF = `(基础 AFF + Anlas × 销售单价 × α / 0.005) × β`，按 4 位小数结算。例如大图 High 第 76 张为 `(5 + 90×5×1.1)×1.1 = 550 AFF`。

NewAPI 的精确公式、分组倍率和 14 模型价格仍见 [已批准的价格报表](nai-parity-pricing-2026-10-23.md)。本次不修改 Gateway 或 NewAPI 价格选项。

## 发布与验证

已上线并完成核验，完成时间 **2026-10-24 02:13:18（Asia/Shanghai）**。镜像为 `love-for-nai:nai-api-coverage-20261024-r1`，替换 `love-for-nai:nai-parity-20261023-r1`。

构建上下文恢复自上一版线上镜像的原始构建缓存，源文件哈希与上一版发布记录一致；仅覆盖以下四个文件，避免携带工作区其他界面修改：

- `src/lib/compat-api.ts`
- `src/app/v1/images/generations/route.ts`
- `src/app/v1/images/edits/route.ts`
- `src/app/ai/encode-vibe/route.ts`

Linux 回归 **9 个测试文件、164 项测试全部通过**，其中 47 项使用真实临时 AFF 钱包、真实 API 路由和模拟上游验证扣费、每日阶梯、退款、流式结算及 NewAPI 回退。生产构建、TypeScript 检查通过。

发布后验证：线上编译的 API 参数解析与 11 组金额通过，Limit 覆盖参数超限被拒绝；17 组 LFN/Gateway 模式报价一致；8 组已部署 Gateway 处理函数的计费 token 与实际 NewAPI 表达式结果一致；14 模型计费配置、分组倍率和每日策略保持不变；服务健康正常。Gateway 容器没有重启或修改。

原 compose 备份：`/home/ikun/love-for-nai-deploy/compose.prod.yml.bak-nai-api-coverage-20261024-r1-20261024021122`。可恢复该 compose 并重建 `lfn-web` 回滚应用；本次没有修改价格配置或数据库。

[结构化部署与验证记录](nai-api-billing-deployed-2026-10-24.json)。核查脚本未发起付费生成，未修改线上用户余额。
