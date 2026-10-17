# LFN 轻量风控实际配置清单（2026-10-17）

本文由本次实现的字段元数据生成，列出后台实际可配置项。通过「管理 → 自动风控 → 轻量风控」修改、校验、保存草稿、预览差异并发布。字段范围和交叉约束由服务器再次校验；配置在单 Node 进程内跨入口共享。

共 96 项基础参数、18 条规则、7 个风险等级，另有证据族上限和带有效期的账号例外。字段缺省值不等于覆盖服务器已发布配置。

## global

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `global.enabled` | 新风险检测（关闭不解除既有处置或每日授权） | `true` | 布尔开关 | — |
| `global.scoreCap` | 风险分数上限 | `200` | 100–1000 | — |
| `global.halfLifeHours` | 观察证据半衰期（小时） | `24` | 1–720 | — |
| `global.maxEvidence` | 每账号活动证据上限 | `64` | 8–256 | — |
| `global.autoLevels` | 按等级自动处置 | `false` | 布尔开关 | 先观察与回放；明确的资源及内容规则仍按各规则模式执行 |
| `global.minimumStrongSignals` | 等级动作最少强证据族 | `1` | 1–8 | — |
| `global.minimumIndependentSignals` | 等级动作最少独立证据族 | `2` | 1–8 | — |
| `global.maxCooldownSeconds` | 自动暂停最长秒数 | `86400` | 60–604800 | — |

## grant

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `grant.enabled` | 个人赠送 AFF 每日出口授权 | `true` | 布尔开关 | 只在实际使用个人奖励 AFF 时检查；购买图包与个人供应商不受该出口绑定影响 |
| `grant.maxActiveExits` | 同时有效出口数 | `1` | 1–4 | — |
| `grant.maxRebinds` | 每日换绑次数 | `2` | 0–20 | — |
| `grant.minRebindSeconds` | 换绑最小间隔（秒） | `900` | 0–86400 | — |
| `grant.strictNoRebind` | 全天禁止换绑 | `false` | 布尔开关 | — |
| `grant.retentionDays` | 授权记录保留天数 | `7` | 1–90 | — |
| `grant.reauthMinutes` | 换绑要求近期登录（分钟） | `15` | 1–60 | — |
| `grant.unknownIp` | 可信来源不可用时 | `"unavailable"` | unavailable / observe | 不使用自报地址建立授权 |

## rate

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `rate.enabled` | 账号令牌桶 | `true` | 布尔开关 | — |
| `rate.perMinute` | 账号持续每分钟请求数 | `30` | 1–10000 | — |
| `rate.preAuthPerMinute` | 鉴权前单凭据/来源保护次数每分钟 | `120` | 1–20000 | — |
| `rate.burst` | 账号突发容量 | `20` | 1–1000 | — |
| `rate.maxInFlight` | 账号同时在途操作上限 | `8` | 1–100 | — |
| `rate.leaseSeconds` | 在途租约超时（秒） | `600` | 30–7200 | — |
| `rate.retrySeconds` | 限流建议重试（秒） | `60` | 1–3600 | — |

## identity

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `identity.cacheSeconds` | 有效外部 Key 身份缓存秒数 | `5` | 0–60 | 0 表示逐请求向账号服务核验；大于0时停用/权限修改存在最多该时长的同步延迟，不超过Key原始有效期 |
| `identity.negativeCacheSeconds` | 无效外部 Key 负缓存秒数 | `15` | 0–60 | — |

## prompt

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `prompt.enabled` | 提示词摘要 | `true` | 布尔开关 | — |
| `prompt.algorithm` | 摘要算法 | `"hmac-sha256"` | hmac-sha256 / sha256 | 普通SHA256可被常见短文本字典猜测 |
| `prompt.unicode` | 统一Unicode | `true` | 布尔开关 | — |
| `prompt.collapseWhitespace` | 合并连续空白 | `true` | 布尔开关 | — |
| `prompt.caseFold` | 忽略大小写 | `false` | 布尔开关 | — |
| `prompt.recentCount` | 每账号近期摘要数 | `16` | 4–128 | — |
| `prompt.minSamples` | 重复比例最少样本 | `10` | 2–128 | — |
| `prompt.repeatPercent` | 精确重复比例阈值（%） | `80` | 1–100 | — |
| `prompt.windowSeconds` | 跨账号索引窗口（秒） | `600` | 10–86400 | — |
| `prompt.minUsers` | 同摘要账号阈值 | `3` | 2–32 | — |
| `prompt.minRequests` | 同摘要请求阈值 | `5` | 2–1000 | — |
| `prompt.maxClusters` | 摘要索引容量 | `2000` | 16–10000 | — |
| `prompt.maxUsersPerCluster` | 每摘要关联账号容量 | `8` | 3–64 | — |

## device

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `device.enabled` | 随机签名设备Cookie | `true` | 布尔开关 | — |
| `device.ttlDays` | Cookie有效天数 | `30` | 1–365 | — |
| `device.maxDevices` | 每账号近期设备容量 | `8` | 2–32 | — |
| `device.maxAccounts` | 每设备账号容量 | `16` | 3–64 | — |
| `device.accountThreshold` | 设备关联账号观察阈值 | `5` | 2–64 | — |
| `device.switchThreshold` | 一小时设备切换阈值 | `8` | 2–100 | — |
| `device.refreshSeconds` | 已知关系刷新秒数 | `3600` | 60–86400 | — |
| `device.retentionDays` | 关联保留天数 | `7` | 1–90 | — |

## quota

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `quota.enabled` | 消耗桶观察 | `true` | 布尔开关 | — |
| `quota.windowSeconds` | 消耗窗口（秒） | `300` | 60–3600 | — |
| `quota.minimumAff` | 绝对AFF消耗门槛 | `100` | 1–1000000 | — |
| `quota.acceleration` | 相对可信基线倍率 | `5` | 2–100 | — |
| `quota.baselineDays` | 最少正常活跃日 | `7` | 2–90 | — |
| `quota.minimumSettlements` | 最少确认结算 | `30` | 5–10000 | — |
| `quota.baselineDelayHours` | 新样本纳入延迟小时 | `24` | 1–168 | — |
| `quota.updateSeconds` | 基线更新秒数 | `900` | 60–86400 | — |

## behavior

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `behavior.enabled` | 低频时段分布观察 | `true` | 布尔开关 | — |
| `behavior.slots` | 每日时段数 | `6` | 2–24 | — |
| `behavior.minimumRecent` | 近期最少调用数 | `30` | 10–10000 | — |
| `behavior.minimumHistory` | 历史最少调用数 | `100` | 20–100000 | — |
| `behavior.deviationPercent` | 分布总变差阈值（%） | `50` | 10–100 | — |

## content

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `content.windowSeconds` | 明确违规窗口秒数 | `600` | 60–86400 | — |
| `content.denyCodes` | 受信上游明确拒绝码（逗号分隔） | `"content_policy_violation,safety_violation,content_filter"` | 文本，最多2000字符 | — |
| `content.passCodes` | 受信上游明确审核通过码（逗号分隔） | `""` | 文本，最多2000字符 | — |
| `content.minDenials` | 独立明确违规次数 | `5` | 2–100 | — |
| `content.afterFeedback` | 反馈后独立违规次数 | `3` | 1–100 | — |
| `content.ratioWindowSeconds` | 拦截比例窗口秒数 | `1800` | 60–86400 | — |
| `content.minReviewed` | 比例最少有效已审操作 | `20` | 5–10000 | — |
| `content.deniedPercent` | 明确拒绝比例（%） | `40` | 1–100 | — |
| `content.retryPerMinute` | 冷却前违背退避次数/分钟 | `10` | 2–1000 | — |
| `content.retryMinutes` | 连续违背退避分钟数 | `2` | 1–10 | — |

## network

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `network.enabled` | 已缓存来源信誉观察 | `true` | 布尔开关 | — |
| `network.ttlHours` | 信誉最大时效小时 | `24` | 1–168 | — |
| `network.countries` | 地区代码观察列表（逗号分隔） | `""` | 文本，最多2000字符 | — |
| `network.ipRetentionDays` | IP诊断证据保留天数 | `30` | 1–90 | — |
| `network.ipIndexCapacity` | IP诊断索引容量 | `5000` | 100–20000 | — |
| `network.maxAccountsPerExit` | 每出口诊断关联账号容量 | `64` | 4–512 | — |
| `network.externalEnabled` | 外部信誉供应商 | `false` | 布尔开关 | 尚未接入自动查询，不可启用 |
| `network.queriesPerMinute` | 外部查询预算/分钟 | `5` | 1–60 | — |
| `network.timeoutMs` | 外部查询超时毫秒 | `1000` | 100–5000 | — |
| `network.queueLimit` | 外部查询队列上限 | `100` | 1–1000 | — |
| `network.negativeTtlSeconds` | 失败负缓存秒数 | `3600` | 60–86400 | — |

## capacity

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `capacity.accounts` | 活跃账号容量 | `2000` | 16–20000 | — |
| `capacity.devices` | 设备索引容量 | `2000` | 16–20000 | — |
| `capacity.cleanupBatch` | 单次清理项数 | `100` | 1–1000 | — |
| `capacity.idleSeconds` | 无活动账号缓存秒数 | `86400` | 600–604800 | — |

## audit

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `audit.flushSeconds` | 普通诊断批写秒数 | `10` | 1–300 | — |
| `audit.batch` | 普通诊断批量条数 | `100` | 10–1000 | — |
| `audit.queueLimit` | 普通诊断队列容量 | `2000` | 100–20000 | — |
| `audit.retentionDays` | 诊断保留天数 | `7` | 1–90 | — |

## trust

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `trust.minimumAccountDays` | 稳定账号最少天数 | `7` | 1–365 | — |
| `trust.autoApprove` | 正常历史达到条件后自动批准有限高频 | `false` | 布尔开关 | — |
| `trust.minimumActiveDays` | 最少正常活跃日 | `3` | 1–90 | — |
| `trust.grantHours` | 高频批准有效小时 | `24` | 1–720 | — |
| `trust.maxRateMultiplier` | 自动批准最大速率倍率 | `2` | 1–5 | — |
| `trust.requestCooldownSeconds` | 高频申请最小间隔秒数 | `300` | 1–86400 | — |

## extensions

| 字段 | 含义 | 默认 | 范围 / 选项 | 说明 |
|---|---|---|---|---|
| `extensions.captcha` | 按需人机验证 | `false` | 布尔开关 | 未接入验证提供商，不可启用 |
| `extensions.semantic` | 语义相似模型 | `false` | 布尔开关 | 未接入，精确摘要不能替代语义模型 |

## 默认规则及分值

所有规则均可配置模式、单次分数、规则累计上限、加分冷却、证据有效期；强证据规则可配置动作和处置期限。证据族及强弱属性固定，弱信号无法通过配置改为确认事实。观察模式只记分；自动等级动作只使用执行模式的证据。

| 编号 | 条件 / 来源 | 单次分 | 上限 | 默认模式 | 默认动作 | 默认处置秒数 |
|---|---|---:|---:|---|---|---:|
| B01 | 单账号精确重复 | 5 | 10 | observe | observe | 300 |
| B02 | 跨账号相同摘要 | 12 | 24 | observe | observe | 300 |
| B03 | 时段偏差 | 3 | 6 | observe | observe | 300 |
| N01 | 出口切换异常 | 8 | 16 | observe | observe | 300 |
| D01 | 设备切换 | 8 | 16 | observe | observe | 300 |
| D02 | 设备多账号 | 10 | 20 | observe | observe | 300 |
| Q01 | 消费突增 | 15 | 30 | observe | observe | 300 |
| Q02 | 消费与独立新设备异常 | 25 | 50 | observe | observe | 300 |
| E01 | 持续违背退避 | 10 | 20 | enforce | rate-limit | 300 |
| C01 | 明确内容违规 | 20 | 80 | enforce | observe | 300 |
| E02 | 反馈后持续违规 | 30 | 80 | enforce | deny | 1800 |
| C02 | 有效已审操作明确拒绝比例 | 20 | 80 | enforce | deny | 86400 |
| N02 | VPN或代理标签 | 3 | 6 | observe | observe | 300 |
| N03 | Tor标签 | 5 | 10 | observe | observe | 300 |
| N04 | 地区观察名单 | 5 | 10 | observe | observe | 300 |
| N05 | 确认恶意信誉 | 20 | 40 | observe | observe | 300 |
| R01 | 确认限制规避 | 40 | 80 | observe | observe | 300 |
| G01 | 确认协同奖励套利 | 60 | 120 | observe | observe | 300 |

N05、R01、G01 通过账号详情中的人工核验入口记录独立事实；需要原因、内部证据编号及明确勾选确认。编号仅保存HMAC摘要，不会从VPN、相同Prompt或邀请关系自动推定这些事实。

## 默认七级阈值

| 等级 | 分数下限 | 等级动作 | 秒数 |
|---|---:|---|---:|
| 正常 / `normal` | 0 | observe | 0 |
| 观察 / `watch` | 20 | observe | 0 |
| 关注 / `elevated` | 40 | observe | 300 |
| 中风险 / `risk` | 60 | rate-limit | 300 |
| 高风险 / `critical` | 90 | rate-limit | 900 |
| 严重风险 / `severe` | 120 | deny | 1800 |
| 紧急隔离 / `isolated` | 160 | deny | 86400 |

等级自动处置开关默认关闭；开启后仍要求独立证据族和强证据族数量。账号手动封禁独立于风险等级和检测开关。分数上限200，默认半衰期24小时；处置具有固定到期时间，不会因无效重试续期。

## 证据族上限与限时例外

默认贡献上限：`{"behavior": 20, "network": 10, "device": 20, "quota": 40, "content": 100, "retry": 20, "relay": 100, "farm": 100}`。各族上限可修改，不能超过总分上限。

账号例外包含 `userId`、`expiresAt`、`reason`、`values`，仅允许覆盖 `rate.perMinute`、`rate.burst`、`rate.maxInFlight`、`grant.maxRebinds`、`grant.minRebindSeconds`。例外不能关闭内容规则、账号手动封禁、额度账本或凭据核验。高频申请批准后写入同一机制，撤销只撤销该申请对应的例外。

交叉校验：摘要样本数和关联账号阈值不能超过对应容量；比例审核样本最小值不超过512条结果缓存；七级阈值必须有序；同账号不能存在重复例外。

## 依赖及数据边界

语义模型、人机验证和外部信誉供应商默认关闭，目前不允许启用。外部查询预算等字段为接入扩展预留，在供应商尚未接入时不产生网络请求。内容通过率仅使用明确审核结果，普通成功响应不被当成“审核通过”。

设备标识是可清除、可转发的随机签名Cookie，不是不可伪造的硬件指纹。设备/IP关联内存容量有上限，重启后需要重新积累；饱和不能认定为无风险。

单进程模式不支持多副本共享原子计数；扩容前需共享存储及多实例并发验证。正常诊断批写可能在进程突然终止时丢失最近一批，资金账本和有效处置单独持久化。

## 计费配置

「每日阶梯计费」模块可分别设置V4.5/V5各档起点、基础价、Anlas倍率、总倍率、换算显示和严格一致性开关。严格一致性默认开启，生图页与API共用账号系列日累计；改变Key不会从低档重新计数。关闭该开关属于显式启用旧计费兼容模式，不能再声称所有调用都经过LFN同一阶梯。固定价模型覆盖原有优先级保持独立。
