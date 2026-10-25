# NAI 对齐计费部署记录（2026-10-23）

部署已完成，完成时间 **2026-10-23 01:37:20（Asia/Shanghai）**。用户授权直接上线，并允许 NewAPI 不接入每日阶梯。

- LFN 镜像：`love-for-nai:nai-parity-20261023-r1`；原镜像：`love-for-nai:nai-official-20261022-r1`。
- Gateway 已更新 `openai.py`、`app.py`，同步模式修复和按张基础费计费量。
- NewAPI 已通过管理 API 更新八条完整模型表达式和六个 Limit 固定价；未直接编辑数据库。
- LFN 每日阶梯原样保留，NewAPI 按 LFN 首档收费；Draw=1、Draw-Limit=1、Draw-Limit-2=0 保留。
- 发布前已备份 compose、Gateway 源码、Nginx 和每日策略。临时生图维护已解除，服务健康正常。

备份目录：`/home/ikun/love-for-nai-deploy/.release-backups/nai-parity-20261023-r1-20261023013643`。NewAPI 私有备份：LFN 数据目录 `pricing-backups/newapi-nai-parity-20261023-1792690625243.json`。备份含 14 个模型的旧表达式、计费模式和固定价，可用 `scripts/apply-nai-parity-pricing.py --rollback <备份文件名>` 恢复价格；服务回滚同时需恢复对应 Gateway 和 LFN 版本。

验证结果：LFN 174 项测试通过；Gateway 175 项测试及 58 个子测试通过；生产构建与 TypeScript 检查通过。线上价格预览验证 14 个模型，发布后配置读回一致；运行镜像 17 组报价通过，8 组已部署处理函数在模拟上游下返回的 p/c 与 NewAPI 公式逐项相符。公开价目中 High 固定价及动态生图基础费均为 5 余额单位。未发起付费生图。

[最终价格与公式](nai-parity-pricing-2026-10-23.md) · [CSV 明细](nai-parity-pricing-2026-10-23.csv) · [结构化部署结果](nai-parity-deployed-2026-10-23.json)
