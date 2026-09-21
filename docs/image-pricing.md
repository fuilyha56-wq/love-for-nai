# 图像余额预估（2026-09-21）

LFN 的 NewAPI 余额和价格统一以美元显示。标准预估与 NewAPI 当前配置分别展示；本次变更不修改远端计费配置，也不修改 AFF / 图包扣费。

## 标准

- 500,000 quota = $1。
- 动态档：1 计费积分（gateway 计算后的 Anlas）= 50 usage token = $0.03 = 15,000 quota。
- V5 限制档：$0.06 = 30,000 quota；V4.5 限制档：免费。
- 完整版 V4.5 / V5 满足 gateway 的限制条件时同样走限制档。`-limit` 模型超界会拒绝请求，不应解释为可以加价生成。
- AFF 是独立的创作额度，不能把 AFF 限制档费用当成 Anlas。

## Gateway 核对

本机 `G:/novelai-gateway/src/proxy/openai.py` 的 `_calc_anlas_cost`、`_anlas_to_tokens`、`_in_opus_free_envelope`、`_billing_prompt_tokens` 为核对依据。

动态档单张基础积分为：

```text
pixels = max(width × height, 65536)
perSample = ceil(2.951823174884865e-6 × pixels
                 + 5.753298233447344e-7 × pixels × steps)
```

图生图强度小于 1 时应用 `max(ceil(perSample × strength), 2)`，然后应用 uncond_scale、张数和参考图附加费。未编码 vibe 每张加 2，超过 4 张的部分每张再加 2；精准参考每张参考图、每个样本加 5。V5 gateway 对最后的生成积分乘 2，随后每积分转为 50 token。Director 工具使用自己的固定积分，不按画布面积估算。

限制档需单请求单张、最多 28 步、面积不超过 1024²、非 priority、无精准参考、无未编码 vibe。纯角色提示词不等于参考图片，不应单独触发动态档。上游非生成操作不适用该限制档。

工作台默认分批并发，每批最多 4 张；一次性模式每请求最多 8 张。发送和预估共用批次规则。1024²、28 步的 V5 生成 3 张会进入动态档，标准预估 $3.60；分批生成 5 张拆为 4 + 1，预估 $4.86，一次性 5 张则预估 $6.00。价格页计算器按单请求计算。超分在当前工作台仅允许 AFF，不展示 NewAPI 付款预估。

## NewAPI 核对与配置对照

[NewAPI 表达式结算源码](https://github.com/QuantumNous/new-api/blob/main/pkg/billingexpr/settle.go) 的 v1 公式是 `quota = expression / 1000000 × QuotaPerUnit × groupRatio`；因此美元单价为 `expression / 1000000 × groupRatio`，不能再除以 200 转成人民币。

[图片中继源码](https://github.com/QuantumNous/new-api/blob/main/relay/image_handler.go) 会把零 prompt token 钳位成 1。已核对的本地 gateway 限制档标记是 V4.5 的 0 与 V5 的 8；这是特殊标记，不是 Anlas。不要用它计算积分。

在该 gateway 标记和分组倍率 1 下，与本次标准匹配的 v1 配置应为：

```text
V5:   p < 100 ? tier("limit", p * 7500) : tier("full", p * 600)
V4.5: p < 100 ? tier("limit", p * 0)    : tier("full", p * 600)
```

按次 `-limit` 的 ModelPrice 分别为 0.06 / 0。以上是配置对照，未自动写入线上。现有 gateway 文档记录过旧价格，部署时需要以实际运行版本和 NewAPI 配置为准；本地未进行真实付费生成或生产账单核验。

## 回归样例

| 请求 | 计费积分 | token | 标准美元 | quota |
| --- | ---: | ---: | ---: | ---: |
| V5，1024²，28 步，1 张 | 固定档 | 特殊标记 | 0.06 | 30,000 |
| V4.5，同上 | 固定档 | 特殊标记 | 0 | 0 |
| V4.5，1024²，29 步，1 张 | 21 | 1,050 | 0.63 | 315,000 |
| V5，1024²，29 步，1 张 | 42 | 2,100 | 1.26 | 630,000 |

对应自动检查在 `tests/image-pricing-points.test.ts` 与 `tests/public-catalog.test.ts`。
