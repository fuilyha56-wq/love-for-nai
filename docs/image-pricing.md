# 图像计费（2026-10-23，已上线）

最新统一价格、p/c 公式和整数 quota 见[已上线对齐报表](nai-parity-pricing-2026-10-23.md)，[部署记录](nai-parity-release-2026-10-23.md)。NewAPI 与 LFN 每日首档相同，NewAPI 不接入每日阶梯，LFN 原阶梯保留。

2026-10-22 的历史修改前后价格、Gateway 公式、NewAPI 表达式与整数 quota 见 [最新审核对比报表](nai-pricing-comparison-2026-10-22.md)，[完整 CSV](nai-pricing-comparison-2026-10-22.csv)。用户确认后已于 2026-10-22 23:13 统一上线，见[部署记录](nai-pricing-release-2026-10-22.md)。

2026-10-23 的全模式核查及新增修正见[逐模式前后对照](nai-mode-pricing-comparison-2026-10-23.md)。该轮已随对齐计费版本发布，包含图生图缺省强度、兼容编辑/批量、缓存参考图和 1 Anlas 工具的 NewAPI 分支修复。

- 1 AFF = ¥0.005。
- 普通 Anlas 售价 ¥0.02，即 4 AFF；V5 保留 1.25 倍销售价 ¥0.025，即 5 AFF。
- 官方 Anlas 先按各模型计算。V5 High 为基础费用乘 1.5 后向上取整；销售倍率不混入官方 Anlas。
- 小图固定费与每日阶梯保留：V4.5 1 AFF、V5 High 5 AFF、Medium 1 AFF。
- 首档大图总费用：基础 AFF + 官方动态 Anlas × 对应 AFF 单价。
- gateway 动态 usage = 官方 Anlas × 50 token。V5 固定档 25、Medium 固定档 18 是特殊标记，不是 Anlas。
- NewAPI 动态售价由其表达式和分组控制；LFN 从实时配置估价。若每人民币对应 S 个站内余额单位，普通动态系数为 400×S，V5 为 500×S。上线时必须与新 gateway 同步切换，保留既有固定档和分组。
- 普通 NAI 画布总面积最多 3,145,728，Limit 最多 1,048,576；宽高均为 64 的倍数。
- 基础费、Anlas 附加费和每日阶梯逐项计算，跨阶梯批量逐张计价并保留退款明细。
- 已只读核对线上阶梯：V4.5 只有首档；V5 从第 76 / 126 / 201 张起调整，同时保留动态倍率与总费倍率。Medium 在 NewAPI 已改为保留小图价、大图按 Anlas 的分档表达式。

90 Anlas 的 V5 High：90×5=450 动态 AFF，加基础 5 AFF，共 455 AFF=¥2.275（每日首档）。360 AFF 仅是未加 V5 销售倍率的普通单价换算基数。
