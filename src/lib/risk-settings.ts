import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type RiskValue = boolean | number | string;
export type RiskMode = "disabled" | "observe" | "enforce";
export type RiskGradeId = "normal" | "watch" | "elevated" | "risk" | "critical" | "severe" | "isolated";
export type RiskActionV2 = "observe" | "rate-limit" | "deny";
export type RiskField = { key: string; group: string; label: string; description: string; value: RiskValue; min?: number; max?: number; options?: string[] };
const fields: RiskField[] = [];
function field(group: string, key: string, label: string, value: RiskValue, min?: number, max?: number, description = "", options?: string[]) {
  fields.push({ group, key: `${group}.${key}`, label, value, min, max, description, options });
}
field("global", "enabled", "新风险检测（关闭不解除既有处置或每日授权）", true);
field("global", "scoreCap", "风险分数上限", 200, 100, 1000);
field("global", "halfLifeHours", "观察证据半衰期（小时）", 24, 1, 720);
field("global", "maxEvidence", "每账号活动证据上限", 64, 8, 256);
field("global", "autoLevels", "按等级自动处置", false, undefined, undefined, "先观察与回放；明确的资源及内容规则仍按各规则模式执行");
field("global", "minimumStrongSignals", "等级动作最少强证据族", 1, 1, 8);
field("global", "minimumIndependentSignals", "等级动作最少独立证据族", 2, 1, 8);
field("global", "maxCooldownSeconds", "自动暂停最长秒数", 86400, 60, 604800);
field("grant", "enabled", "个人赠送 AFF 每日出口授权", true, undefined, undefined, "只在实际使用个人奖励 AFF 时检查；购买图包与个人供应商不受该出口绑定影响");
field("grant", "maxActiveExits", "同时有效出口数", 1, 1, 4);
field("grant", "maxRebinds", "每日换绑次数", 2, 0, 20);
field("grant", "minRebindSeconds", "换绑最小间隔（秒）", 900, 0, 86400);
field("grant", "strictNoRebind", "全天禁止换绑", false);
field("grant", "retentionDays", "授权记录保留天数", 7, 1, 90);
field("grant", "reauthMinutes", "换绑要求近期登录（分钟）", 15, 1, 60);
field("grant", "unknownIp", "可信来源不可用时", "unavailable", undefined, undefined, "不使用自报地址建立授权", ["unavailable", "observe"]);
field("rate", "enabled", "账号令牌桶", true);
field("rate", "perMinute", "账号持续每分钟请求数", 30, 1, 10000);
field("rate", "preAuthPerMinute", "鉴权前单凭据/来源保护次数每分钟", 120, 1, 20000);
field("rate", "burst", "账号突发容量", 20, 1, 1000);
field("rate", "maxInFlight", "账号同时在途操作上限", 8, 1, 100);
field("rate", "leaseSeconds", "在途租约超时（秒）", 600, 30, 7200);
field("rate", "retrySeconds", "限流建议重试（秒）", 60, 1, 3600);
field("identity", "cacheSeconds", "有效外部 Key 身份缓存秒数", 5, 0, 60, "0 表示逐请求向账号服务核验；大于0时停用/权限修改存在最多该时长的同步延迟，不超过Key原始有效期");
field("identity", "negativeCacheSeconds", "无效外部 Key 负缓存秒数", 15, 0, 60);
field("prompt", "enabled", "提示词摘要", true);
field("prompt", "algorithm", "摘要算法", "hmac-sha256", undefined, undefined, "普通SHA256可被常见短文本字典猜测", ["hmac-sha256", "sha256"]);
field("prompt", "unicode", "统一Unicode", true);
field("prompt", "collapseWhitespace", "合并连续空白", true);
field("prompt", "caseFold", "忽略大小写", false);
field("prompt", "recentCount", "每账号近期摘要数", 16, 4, 128);
field("prompt", "minSamples", "重复比例最少样本", 10, 2, 128);
field("prompt", "repeatPercent", "精确重复比例阈值（%）", 80, 1, 100);
field("prompt", "windowSeconds", "跨账号索引窗口（秒）", 600, 10, 86400);
field("prompt", "minUsers", "同摘要账号阈值", 3, 2, 32);
field("prompt", "minRequests", "同摘要请求阈值", 5, 2, 1000);
field("prompt", "maxClusters", "摘要索引容量", 2000, 16, 10000);
field("prompt", "maxUsersPerCluster", "每摘要关联账号容量", 8, 3, 64);
field("device", "enabled", "随机签名设备Cookie", true);
field("device", "ttlDays", "Cookie有效天数", 30, 1, 365);
field("device", "maxDevices", "每账号近期设备容量", 8, 2, 32);
field("device", "maxAccounts", "每设备账号容量", 16, 3, 64);
field("device", "accountThreshold", "设备关联账号观察阈值", 5, 2, 64);
field("device", "switchThreshold", "一小时设备切换阈值", 8, 2, 100);
field("device", "refreshSeconds", "已知关系刷新秒数", 3600, 60, 86400);
field("device", "retentionDays", "关联保留天数", 7, 1, 90);
field("quota", "enabled", "消耗桶观察", true);
field("quota", "windowSeconds", "消耗窗口（秒）", 300, 60, 3600);
field("quota", "minimumAff", "绝对AFF消耗门槛", 100, 1, 1000000);
field("quota", "acceleration", "相对可信基线倍率", 5, 2, 100);
field("quota", "baselineDays", "最少正常活跃日", 7, 2, 90);
field("quota", "minimumSettlements", "最少确认结算", 30, 5, 10000);
field("quota", "baselineDelayHours", "新样本纳入延迟小时", 24, 1, 168);
field("quota", "updateSeconds", "基线更新秒数", 900, 60, 86400);
field("behavior", "enabled", "低频时段分布观察", true);
field("behavior", "slots", "每日时段数", 6, 2, 24);
field("behavior", "minimumRecent", "近期最少调用数", 30, 10, 10000);
field("behavior", "minimumHistory", "历史最少调用数", 100, 20, 100000);
field("behavior", "deviationPercent", "分布总变差阈值（%）", 50, 10, 100);
field("content", "windowSeconds", "明确违规窗口秒数", 600, 60, 86400);
field("content", "denyCodes", "受信上游明确拒绝码（逗号分隔）", "content_policy_violation,safety_violation,content_filter");
field("content", "passCodes", "受信上游明确审核通过码（逗号分隔）", "");
field("content", "minDenials", "独立明确违规次数", 5, 2, 100);
field("content", "afterFeedback", "反馈后独立违规次数", 3, 1, 100);
field("content", "ratioWindowSeconds", "拦截比例窗口秒数", 1800, 60, 86400);
field("content", "minReviewed", "比例最少有效已审操作", 20, 5, 10000);
field("content", "deniedPercent", "明确拒绝比例（%）", 40, 1, 100);
field("content", "retryPerMinute", "冷却前违背退避次数/分钟", 10, 2, 1000);
field("content", "retryMinutes", "连续违背退避分钟数", 2, 1, 10);
field("network", "enabled", "已缓存来源信誉观察", true);
field("network", "ttlHours", "信誉最大时效小时", 24, 1, 168);
field("network", "countries", "地区代码观察列表（逗号分隔）", "");
field("network", "ipRetentionDays", "IP诊断证据保留天数", 30, 1, 90);
field("network", "ipIndexCapacity", "IP诊断索引容量", 5000, 100, 20000);
field("network", "maxAccountsPerExit", "每出口诊断关联账号容量", 64, 4, 512);
field("network", "externalEnabled", "外部信誉供应商", false, undefined, undefined, "尚未接入自动查询，不可启用");
field("network", "queriesPerMinute", "外部查询预算/分钟", 5, 1, 60);
field("network", "timeoutMs", "外部查询超时毫秒", 1000, 100, 5000);
field("network", "queueLimit", "外部查询队列上限", 100, 1, 1000);
field("network", "negativeTtlSeconds", "失败负缓存秒数", 3600, 60, 86400);
field("capacity", "accounts", "活跃账号容量", 2000, 16, 20000);
field("capacity", "devices", "设备索引容量", 2000, 16, 20000);
field("capacity", "cleanupBatch", "单次清理项数", 100, 1, 1000);
field("capacity", "idleSeconds", "无活动账号缓存秒数", 86400, 600, 604800);
field("audit", "flushSeconds", "普通诊断批写秒数", 10, 1, 300);
field("audit", "batch", "普通诊断批量条数", 100, 10, 1000);
field("audit", "queueLimit", "普通诊断队列容量", 2000, 100, 20000);
field("audit", "retentionDays", "诊断保留天数", 7, 1, 90);
field("trust", "enabled", "启用高频申请与账号高频限制", true, undefined, undefined, "关闭后隐藏申请菜单，不执行这套账号令牌桶和在途限制；系统原有限速、通道并发及内容处置仍生效");
field("trust", "minimumAccountDays", "稳定账号最少天数", 7, 1, 365);
field("trust", "autoApprove", "正常历史达到条件后自动批准有限高频", false);
field("trust", "minimumActiveDays", "最少正常活跃日", 3, 1, 90);
field("trust", "grantHours", "高频批准有效小时", 24, 1, 720);
field("trust", "maxRateMultiplier", "自动批准最大速率倍率", 2, 1, 5);
field("trust", "requestCooldownSeconds", "高频申请最小间隔秒数", 300, 1, 86400);
field("extensions", "captcha", "按需人机验证", false, undefined, undefined, "未接入验证提供商，不可启用");
field("extensions", "semantic", "语义相似模型", false, undefined, undefined, "未接入，精确摘要不能替代语义模型");
export const RISK_FIELDS = fields;

export type RiskRuleConfig = { id: string; label: string; family: string; mode: RiskMode; points: number; maxPoints: number; cooldownSeconds: number; expiresSeconds: number; action: RiskActionV2; durationSeconds: number; strong: boolean };
const definitions: Array<[string, string, string, number, boolean]> = [
  ["B01", "单账号精确重复", "behavior", 5, false], ["B02", "跨账号相同摘要", "behavior", 12, false], ["B03", "时段偏差", "behavior", 3, false],
  ["N01", "出口切换异常", "network", 8, false], ["D01", "设备切换", "device", 8, false], ["D02", "设备多账号", "device", 10, false],
  ["Q01", "消费突增", "quota", 15, false], ["Q02", "消费与独立新设备异常", "quota", 25, true],
  ["E01", "持续违背退避", "retry", 10, true], ["C01", "明确内容违规", "content", 20, true], ["E02", "反馈后持续违规", "content", 30, true],
  ["C02", "有效已审操作明确拒绝比例", "content", 20, true],
  ["N02", "VPN或代理标签", "network", 3, false], ["N03", "Tor标签", "network", 5, false], ["N04", "地区观察名单", "network", 5, false],
  ["N05", "确认恶意信誉", "network", 20, true], ["R01", "确认限制规避", "relay", 40, true], ["G01", "确认协同奖励套利", "farm", 60, true],
];
export type RiskGrade = { id: RiskGradeId; name: string; minimum: number; action: RiskActionV2; durationSeconds: number; color: string };
export type RiskOverride = { userId: number; expiresAt: string; reason: string; values: Record<string, RiskValue> };
export type RiskSettings = { version: string; values: Record<string, RiskValue>; rules: RiskRuleConfig[]; levels: RiskGrade[]; overrides: RiskOverride[]; familyCaps: Record<string, number> };
export function defaultRiskSettings(): RiskSettings {
  return {
    version: "light-risk-v2", values: Object.fromEntries(fields.map(f => [f.key, f.value])),
    rules: definitions.map(([id, label, family, points, strong]) => ({ id, label, family, points, strong, mode: strong && ["C01", "C02", "E01", "E02"].includes(id) ? "enforce" : "observe", maxPoints: family === "content" ? 80 : points * 2, cooldownSeconds: id === "C01" ? 0 : 600, expiresSeconds: 86400, action: ["E02", "C02"].includes(id) ? "deny" : id === "E01" ? "rate-limit" : "observe", durationSeconds: id === "C02" ? 86400 : id === "E02" ? 1800 : 300 })),
    levels: [
      { id: "normal", name: "正常", minimum: 0, action: "observe", durationSeconds: 0, color: "#64748b" },
      { id: "watch", name: "观察", minimum: 20, action: "observe", durationSeconds: 0, color: "#a16207" },
      { id: "elevated", name: "关注", minimum: 40, action: "observe", durationSeconds: 300, color: "#ca8a04" },
      { id: "risk", name: "中风险", minimum: 60, action: "rate-limit", durationSeconds: 300, color: "#ea580c" },
      { id: "critical", name: "高风险", minimum: 90, action: "rate-limit", durationSeconds: 900, color: "#dc2626" },
      { id: "severe", name: "严重风险", minimum: 120, action: "deny", durationSeconds: 1800, color: "#be123c" },
      { id: "isolated", name: "紧急隔离", minimum: 160, action: "deny", durationSeconds: 86400, color: "#881337" },
    ], overrides: [], familyCaps: { behavior: 20, network: 10, device: 20, quota: 40, content: 100, retry: 20, relay: 100, farm: 100 },
  };
}
const root = () => path.resolve(process.env.LFN_DATA_DIR || "data", "risk");


const policyRuntime = globalThis as typeof globalThis & { __lfnRiskSettings?: {
 cache?: { root: string; settings: Promise<RiskSettings> }; resolved?: { root: string; settings: RiskSettings }; mutation: Promise<unknown>;
} };
const shared = (policyRuntime.__lfnRiskSettings ??= { mutation: Promise.resolve() });
const fallbackSettings = defaultRiskSettings();

export async function writeRiskJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await rename(temporary, file);
}
export function validateRiskSettings(raw: RiskSettings): RiskSettings {
  if (!raw || typeof raw !== "object" || !raw.values || !Array.isArray(raw.rules) || !Array.isArray(raw.levels) || !Array.isArray(raw.overrides)) throw new Error("策略结构无效");
  if (Object.keys(raw).some(k => !["version", "values", "rules", "levels", "overrides", "familyCaps"].includes(k))) throw new Error("策略存在未知字段");
  const defaults = defaultRiskSettings();
  for (const [key, value] of Object.entries(raw.values)) {
    const meta = fields.find(f => f.key === key);
    if (!meta || typeof value !== typeof meta.value) throw new Error(`未知配置或类型错误：${key}`);
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < meta.min! || value > meta.max!)) throw new Error(`配置超出范围：${key}`);
    if (typeof value === "string" && (value.length > 2000 || meta.options && !meta.options.includes(value))) throw new Error(`配置值无效：${key}`);
    if (["network.externalEnabled", "extensions.captcha", "extensions.semantic"].includes(key) && value) throw new Error(`${key} 尚未接入，不能启用`);
  }
  const values = { ...defaults.values, ...raw.values };
  if (Number(values["prompt.minSamples"]) > Number(values["prompt.recentCount"]) || Number(values["prompt.minUsers"]) > Number(values["prompt.maxUsersPerCluster"])) throw new Error("样本阈值不能超过对应容量");
  if (Number(values["device.accountThreshold"]) > Number(values["device.maxAccounts"]) || Number(values["content.minReviewed"]) > 512) throw new Error("关联或审核样本阈值超过对应容量");
  if (raw.rules.length !== definitions.length || new Set(raw.rules.map(r => r.id)).size !== definitions.length) throw new Error("规则列表缺失或重复");
  for (const rule of raw.rules) {
    if (Object.keys(rule).some(k => !["id", "label", "family", "mode", "points", "maxPoints", "cooldownSeconds", "expiresSeconds", "action", "durationSeconds", "strong"].includes(k)) || typeof rule.label !== "string" || rule.label.length > 80) throw new Error("规则字段无效");
    const original = defaults.rules.find(r => r.id === rule.id);
    if (!original || rule.family !== original.family || rule.strong !== original.strong || !["disabled", "observe", "enforce"].includes(rule.mode) || !["observe", "rate-limit", "deny"].includes(rule.action)) throw new Error("规则标识、证据级别或动作无效");
    for (const key of ["points", "maxPoints", "cooldownSeconds", "expiresSeconds", "durationSeconds"] as const) if (!Number.isSafeInteger(rule[key]) || rule[key] < 0 || rule[key] > (key.includes("Seconds") ? 604800 : Number(values["global.scoreCap"]))) throw new Error(`规则数值无效：${rule.id}.${key}`);
    if (rule.maxPoints < rule.points || rule.expiresSeconds < 1 || rule.mode === "enforce" && rule.action !== "observe" && rule.durationSeconds < 1) throw new Error("规则上限/有效期需合法，执行动作必须设置正数处置期限");
  }
  if (raw.levels.length !== 7 || new Set(raw.levels.map(l => l.id)).size !== 7) throw new Error("必须包含七个不同风险等级");
  for (const [index, level] of raw.levels.entries()) {
    if (level.id !== defaults.levels[index].id || !level.name?.trim() || level.name.length > 30 || !/^#[\da-f]{6}$/i.test(level.color) || !Number.isInteger(level.minimum) || level.minimum < 0 || level.minimum > Number(values["global.scoreCap"]) || (index === 0 ? level.minimum !== 0 : level.minimum <= raw.levels[index - 1].minimum) || !["observe", "rate-limit", "deny"].includes(level.action) || !Number.isInteger(level.durationSeconds) || level.durationSeconds < 0 || level.durationSeconds > Number(values["global.maxCooldownSeconds"])) throw new Error("等级阈值、颜色或处置期限无效");
  }
  if (raw.overrides.length > 500) throw new Error("个体例外过多");
  if (new Set(raw.overrides.map(o => o.userId)).size !== raw.overrides.length) throw new Error("同账号存在重复例外，请合并后发布");
  for (const override of raw.overrides) {
    if (!Number.isSafeInteger(override.userId) || override.userId <= 0 || !override.reason?.trim() || !Number.isFinite(Date.parse(override.expiresAt))) throw new Error("个体例外无效");
    for (const [key, value] of Object.entries(override.values)) {
      if (!["rate.perMinute", "rate.burst", "rate.maxInFlight", "grant.maxRebinds", "grant.minRebindSeconds"].includes(key)) throw new Error("例外仅允许调整调用节奏和换绑，不允许豁免安全事实");
      const f = fields.find(f => f.key === key)!;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < f.min! || value > f.max!) throw new Error("例外数值无效");
    }
  }
  for (const [family, cap] of Object.entries(raw.familyCaps || {})) if (!Object.hasOwn(defaults.familyCaps, family) || !Number.isSafeInteger(cap) || cap < 0 || cap > Number(values["global.scoreCap"])) throw new Error("证据族上限无效");
  return { version: String(raw.version || "").slice(0, 100), values, rules: structuredClone(raw.rules), levels: structuredClone(raw.levels), overrides: structuredClone(raw.overrides), familyCaps: { ...defaults.familyCaps, ...raw.familyCaps } };
}
export async function getRiskSettings(userId?: number): Promise<RiskSettings> {
  const directory = root();
  if (shared.cache?.root !== directory) shared.cache = { root: directory, settings: readFile(path.join(directory, "settings-v2.json"), "utf8").then(s => validateRiskSettings(JSON.parse(s))).catch(error => { if (error.code === "ENOENT") return defaultRiskSettings(); throw error; }) };
  const settings = await shared.cache.settings;
  shared.resolved = { root: directory, settings };
  const override = userId ? settings.overrides.find(o => o.userId === userId && Date.parse(o.expiresAt) > Date.now()) : undefined;
  return override ? { ...settings, values: { ...settings.values, ...override.values } } : settings;
}
export function cachedRiskSettings(userId?: number): RiskSettings {
  const settings = shared.resolved?.root === root() ? shared.resolved.settings : fallbackSettings;
  const override = userId ? settings.overrides.find(o => o.userId === userId && Date.parse(o.expiresAt) > Date.now()) : undefined;
  return override ? { ...settings, values: { ...settings.values, ...override.values } } : settings;
}
export async function publishRiskSettings(raw: RiskSettings, expectedVersion: string, operator: string, reason: string) {
  const task = shared.mutation.then(async () => {
    const current = await getRiskSettings();
    if (current.version !== expectedVersion) throw new Error("策略已更新，请重新读取后合并修改");
    if (!reason.trim()) throw new Error("请填写发布原因");
    const settings = validateRiskSettings(raw);
    settings.version = `risk-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await writeRiskJson(path.join(root(), "policy-history", `${settings.version}.json`), { before: current, after: settings, operator, reason: reason.slice(0, 500), at: new Date().toISOString() });
    await writeRiskJson(path.join(root(), "settings-v2.json"), settings);
    shared.cache = { root: root(), settings: Promise.resolve(settings) };
    shared.resolved = { root: root(), settings };
    return settings;
  });
  shared.mutation = task.catch(() => undefined);
  return task;
}
export const riskNumber = (s: RiskSettings, key: string) => Number(s.values[key]);
export const riskFlag = (s: RiskSettings, key: string) => s.values[key] === true;
export function resetRiskSettingsCache() { shared.cache = undefined; shared.resolved = undefined; }
