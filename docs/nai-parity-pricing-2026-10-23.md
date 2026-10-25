# NewAPI / LFN 对齐价格（2026-10-23，已上线）

已于 2026-10-23 01:37:20（Asia/Shanghai）上线，见[部署记录](nai-parity-release-2026-10-23.md)。用户已授权直接上线。此次以 **LFN 每日首档**为标准对齐 NewAPI，LFN 原有每日阶梯继续保留，NewAPI 不实现每日阶梯。以标准 Draw / Draw-Limit 分组 G=1 对照；Draw-Limit-2 的零倍率优惠保留。

1 AFF=¥0.005；普通 Anlas=¥0.02；V5 保留 1.25 倍售价，即 ¥0.025/Anlas。图像完整成功后，基础费和动态费按同一口径结算。两个钱包是独立支付来源，不重复扣款。

| 场景 | 旧 NewAPI 人民币 | 新 NewAPI 人民币 | LFN 首档人民币 / AFF |
| --- | ---: | ---: | ---: |
| V4.5 小图及 Limit | 0 | 0.005 | 0.005 / 1 |
| V5 High 小图及 Full/Curated Limit | 0.04 | 0.025 | 0.025 / 5 |
| V5 Inpaint Limit | 0.03 | 0.025 | 0.025 / 5 |
| V5 Medium 小图 | 0.01730769 | 0.005 | 0.005 / 1 |
| V4.5 大图，60 Anlas | 1.20 | 1.205 | 1.205 / 241 |
| V5 High 大图，90 Anlas | 2.25 | 2.275 | 2.275 / 455 |
| V5 High 图生图，63 Anlas | 1.575 | 1.60 | 1.60 / 320 |
| V5 High 图生图，50 Anlas | 1.25 | 1.275 | 1.275 / 255 |
| V5 Medium 大图，51 Anlas | 1.275 | 1.28 | 1.28 / 256 |
| V5 High 大图两张，180 Anlas | 4.50 | 4.55 | 4.55 / 910 |
| V5 超分，1 Anlas | 0.04（误入固定档） | 0.025 | 0.025 / 5 |
| V5 超分，4 Anlas | 0.10 | 0.10 | 0.10 / 20 |
| 五张缓存 Vibe，1024² / 23步 | 0.04（误入固定档） | 0.725 | 0.725 / 145 |

旧价为已有有效参数的标准 API 收费；原生图生图遗漏强度和兼容编辑忽略强度的问题另见[模式核查记录](nai-mode-pricing-comparison-2026-10-23.md)。相同尺寸、参数与请求拆分方式下，新 NewAPI 与 LFN 首档对齐。批量拆成多次单张请求时，每次独立判断固定档和编码费。

## Gateway 与 NewAPI 的对应公式

Gateway 的官方 Anlas 算法与模式修复保留。`X-Anlas-Cost` 继续报告计算的 Anlas，不混入销售倍率或基础 AFF。

```text
生成动态档：p = 50 × 本次 Anlas，c = 本次生图张数
生成固定档：High p=25、Medium p=18、V4.5 p=0（NewAPI 可能补为1）
独立超分 / Director 等工具：p = 50 × 工具 Anlas，c = 0
total_tokens = p + c
```

这里 p/c 是网关与 NewAPI 的计费单位。c 记录生成基础费的张数；独立工具不加生成基础费。NAI JSON、普通图片 JSON 和兼容编辑接口都使用同一计费量。

V4.5 Full / Curated / Inpaint：

```text
p <= 1 ? tier("limit", p * 0 + c * 0 + 1000000) : tier("full", p * 80000 + c * 1000000)
```

V5 High Full / Curated / Inpaint：

```text
p == 25 ? tier("limit", p * 0 + c * 0 + 5000000) : tier("full", p * 100000 + c * 5000000)
```

V5 Full Medium / Inpaint Medium：

```text
p == 18 ? tier("limit", p * 0 + c * 0 + 1000000) : tier("full", p * 100000 + c * 1000000)
```

六个 Limit 别名继续使用原按次模式：V4.5 ModelPrice=1，V5 High ModelPrice=5。仍限制 1048576 px、28步、一次一张；不会因改价开放付费工具或参考图。

```text
Q = 500000 quota / 余额单位
S = 200 余额单位 / 人民币
E = 表达式结果
quota = round(E / 1000000 × Q × G)
人民币 = quota / (Q × S) = quota / 100000000
```

例如 V5 High 90 Anlas / 一张：p=4500、c=1，E=4500×100000+1×5000000=455000000，quota=227500000，NewAPI=¥2.275，LFN=455 AFF=¥2.275。单张 1 Anlas 超分 p=50、c=0，E=5000000，NewAPI=¥0.025，与 LFN 5 AFF 一致。

NewAPI v1.0.0-rc.41 的图像处理保留 `completion_tokens`，表达式以 c 参与结算；预扣使用 c=0，不引入输出 token 大额预扣。已通过线上只读价格预览校验 14 个模型的配置。实施使用 NewAPI 管理 API，私有备份后读回核对，无需直接改数据库。

## 每日阶梯与验证范围

LFN V5 High / Medium 的第 76、126、201 张起原阶梯不变；NewAPI 始终按以上首档价，超过每日首档时两端金额可能不同。这是按用户补充要求保留的差异。

基础公式里的长系数和 Medium 修正因子来自项目既有算法，并已核对官网样例；Director 的 5/65 Anlas 是沿用已有网关常量，未逐项做官方实扣核查。没有发起付费生图；验证包括模拟上游请求、编译产物报价与线上配置读回。

完整场景的 Anlas、p/c、AFF、人民币与整数 quota：[CSV](nai-parity-pricing-2026-10-23.csv)。逐模型配置：[变更清单](nai-parity-pricing-proposal-2026-10-23.json)。上线状态与备份位置见后续部署记录。
