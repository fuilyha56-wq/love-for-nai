# NAI 新超分（Standalone Upscale）接入文档

> 调研方式：抓取 novelai.net 生产 webui JS bundle（buildId 3102745-production）逆向 + 持久 token 实测上游。
> 实测日期：2026-09-12。本文同时覆盖上游规格、gateway 变更、LFN 变更与使用方法。

## 1. 上游规格（逆向 + 实测结论）

NovelAI 已将独立超分端点 `/ai/upscale` **从旧 ESRGAN 参数整体切换为 V5 扩散超分模型**。旧参数格式已下线。

### 1.1 端点

```
POST https://image.novelai.net/ai/upscale
Authorization: Bearer <NAI token>
Content-Type: application/json
```

### 1.2 请求体（新格式，webui 实际发送）

```json
{
  "image": "<PNG base64，不带 data: 前缀>",
  "model": "nai-diffusion-5-curated",
  "declared_blur_sigma": 0
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `image` | string | 输入 PNG 的 base64。输出固定为**输入的 2 倍**（宽高各 ×2，无倍率参数） |
| `model` | string | 只接受 `nai-diffusion-5-full` 与 `nai-diffusion-5-curated`（webui 硬编码 curated） |
| `declared_blur_sigma` | number | webui 恒定传 0（模块常量 `Kx=0`），按 0 透传即可 |

### 1.3 响应

- 成功：`200`，`binary/octet-stream`，**ZIP 压缩包**，内含 `image_0.png`（尺寸 = 输入 ×2）。
- 失败：JSON 错误体 `{statusCode, message}`。

### 1.4 计费（NAI 官网 JS 逆向出的价格表）

按**输入图片像素面积**查表（webui `f=[[1048576,1],[1747627,2],[2446678,3],[3145728,4]]`）：

| 输入面积 | 典型尺寸 | 消耗 |
|---|---|---|
| ≤ 1,048,576（1MP） | 832×1216、1024×1024 | **1** |
| ≤ 1,747,627 | 1024×1536、1216×1437 | **2** |
| ≤ 2,446,678 | 1472×1472、1216×2012 | **3** |
| ≤ 3,145,728（上限 1536×2048） | 1536×2048 | **4** |
| > 3,145,728 | — | 服务端 400 拒绝 |

即用户口中的“小图 1 积分、大图 2 积分”（常用尺寸落在 1–2 积分档，最大可到 4）。

### 1.5 限制与错误（全部实测复现）

| 场景 | 上游返回 |
|---|---|
| 旧参数 `{image,width,height,scale}` | `400 "Validation error: model  doesn't exist"`（**旧格式已死**） |
| `model: "nai-diffusion-3"` / `"nai-diffusion-4-5-full"` | `400 "… doesn't support standalone upscaling"`（仅 V5 双模型支持） |
| 输入面积 4,046,848 px | `400 "image is too large to upscale: 4046848 pixels, maximum is 3145728"` |

### 1.6 实测记录（共享池 token）

| # | 请求 | 结果 |
|---|---|---|
| 1 | 832×1216 PNG + `nai-diffusion-5-curated` | 200，ZIP 内 `image_0.png` **1664×2432**（精确 2x） |
| 2 | 同图 + `nai-diffusion-5-full` | 200，1664×2432 |
| 3 | 旧参数格式 | 400（如上） |
| 4 | 1664×2432（4.05MP）回投 | 400 超限（如上） |

### 1.7 附注：Director 工具里的 upscale

`/ai/augment-image`（`req_type:"upscale"`）也挂了一个超分工具，但**只接受 ≤1MP 输入**（>1MP 直接置灰），固定 1 积分。主入口（本文档接入的）是 `/ai/upscale`，能力是它的超集。

## 2. Gateway 变更（novelai-gateway）

### 2.1 修复 `/v1/images/upscale`（openai 兼容端点）

`handle_upscale` 原来转发旧参数 `{image,width,height,scale}` → 上游 400，属于**已损坏**。现改为：

- 请求体：`{"image": "...", "model": "nai-diffusion-5-full|nai-diffusion-5-curated(默认)", "declared_blur_sigma": 0(默认)}`
- 服务端校验 model ∈ V5 双模型、image 非空；拒绝携带旧字段 `scale`/`defry` 的请求（提示已不支持）
- 原样透传 NAI 的 ZIP 响应与 JSON 错误（NAI 错误信息本身已经足够明确）
- 统一对外仍返回 ZIP（与 NAI 原生行为一致），`/ai/*` 原生透传路径无需改动（body 原样转发）

### 2.2 新增 `/ai/upscale` 缓冲式原生路由（重要）

通用 `/ai/{path}` 原生透传对 `binary/octet-stream` 响应走 StreamingResponse 分支，并把 heavy 门控锁（`pop_all`）持有到流结束。实测发现该路径下锁会泄漏：超分响应发完后锁从未归还，后续所有 heavy 请求（生成/超分）全部「排队超时」。

因此为 `/ai/upscale` 增加了**注册在 catch-all 之前**的专用路由：整包缓冲 → 立即还锁 → 返回，`async with gate` 确定性释放。测试 `test_native_upscale_route_registered_before_catch_all` 固化路由顺序。

### 2.3 计费口径

gateway 侧不做扣费（共享池消耗由 LFN 侧审计），仅保持现有统计。

## 3. LFN 变更（love-for-nai）

### 3.1 计费（`src/lib/image-pricing.ts`）

`affCost` 的 `operation:"upscale"` 从旧的固定 `4×samples` AFF 改为与 NAI 1:1 的面积档位：

```ts
upscaleAnlasCost(width, height) // 1 | 2 | 3 | 4，>3145728 抛错
UPSCALE_MAX_PIXELS = 3_145_728
```

LFN AFF 消耗 = NAI Anlas 消耗，图包/个人 AFF、退款逻辑不变（samples 恒为 1）。

### 3.2 `/ai/upscale` NAI 原生路由

- 入参兼容 data URL 与裸 base64；`model` 默认 `nai-diffusion-5-curated`，白名单同上
- **服务端解析 PNG IHDR 得到真实宽高**（不信任客户端传参），超上限直接 400
- 按 §3.1 计费、失败退款，之后经 gateway `/ai/*` 原生透传转发（body 即新格式）

### 3.3 `/api/images/operate` 解锁 upscale

原 409 拦截移除，新增 upscale 分支：计费 → 调上游 → ZIP 解包（JSZip）→ `saveHistory` → 返回与其它操作一致的 `{images, payment, paymentSource, aff}` JSON。请求字段 `upscale_model`（`nai-diffusion-5-full` / `nai-diffusion-5-curated`），与生成模型字段 `model` 解耦。

### 3.4 Studio 前端入口

- “放大”操作从 `unsupportedOperations` 移出，可正常提交
- 源图自动统一为 PNG（canvas 重编码，杜绝 JPEG/WEBP 直接投喂上游报错），并解析出真实宽高
- 超过 3145728 px 时前端先拦（提示去缩放后再来）
- 参数区显示：输出尺寸（输入 ×2）、本次消耗（1–4 AFF 档位）、超分模型选择（默认 curated）
- 生成按钮上的费用估算自动跟随新口径

## 4. 使用方法

### 4.1 站内（Studio）

创作中心 → 图片生成 → 操作选 **放大** → 上传/选择源图 → 选超分模型（默认 curated）→ 提交。结果自动计入图片历史。

### 4.2 NAI 原生格式（经 LFN）

```bash
curl -X POST https://<lfn>/ai/upscale \
  -H "Authorization: Bearer <LFN API Key>" \
  -H "Content-Type: application/json" \
  -d '{"image":"<png base64>","model":"nai-diffusion-5-curated","declared_blur_sigma":0}'
# 200 → application/zip（image_0.png = 输入 2x）；扣 1–4 AFF（按输入面积）
```

### 4.3 Gateway openai 兼容格式

```bash
curl -X POST http://<gateway>:41555/v1/images/upscale \
  -H "Authorization: Bearer <Gateway Key>" \
  -H "Content-Type: application/json" \
  -d '{"image":"<png base64>","model":"nai-diffusion-5-curated"}'
```

## 5. 测试与部署（2026-09-12 已完成）

- gateway：`tests/test_gateway.py` 覆盖新 payload 构造、旧字段拒绝、模型白名单、路由顺序（121 通过）
- LFN：`tests/upscale-superres.test.ts` 覆盖 `upscaleAnlasCost` 档位、PNG IHDR 解析、`affCost` upscale 分支（全量 167 通过）
- 线上部署：`love-for-nai:superres-20260912` 镜像 + gateway src 同步，两容器已重启并打通容器网络
- **线上端到端实测**：LFN `/ai/upscale`（832×1216，curated）→ 200 ZIP → `image_0.png` **1664×2432**；AFF 账本精确扣 1（`-1 generation "…832x1216，1 张使用个人 AFF"`），余额 5→4；测试账本与测试 token 已清理还原

## 6. 上游快照存档

- webui JS chunk 存档：`E:\tmp_nai_research\chunks\`（buildId 3102745-production）
- 关键常量来源：module 44868（`gb="nai-diffusion-5-curated"`, `Kx=0`, `aS=2`）、module 50464（价格表）、module 85097（`xM=3145728`）
- 实测脚本与样本：`E:\tmp_nai_research\`（ups_body.json / ups_out.bin / upscaled_result.png）
