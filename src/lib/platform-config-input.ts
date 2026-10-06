import type { EndpointConfig } from "@/lib/adapters/types";
import { optionalNumber, optionalString } from "@/lib/request";
import type { RuntimeSettings } from "@/lib/runtime-config";

const ENDPOINT_TYPES = new Set(["auth", "image", "wallet"]);
const ADAPTER_TYPES = new Set(["newapi", "local", "openai_compat", "gateway"]);

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function parseRuntimeSettingsPatch(raw: Record<string, unknown>): Partial<RuntimeSettings> {
  const authProvider = optionalString(raw.authProvider);
  if (authProvider && authProvider !== "newapi" && authProvider !== "local")
    throw new Error("账号提供者只能是 newapi 或 local");
  const quotaPerUnit = optionalNumber(raw.quotaPerUnit);
  if (quotaPerUnit !== undefined && (!Number.isInteger(quotaPerUnit) || quotaPerUnit <= 0))
    throw new Error("余额单位必须是正整数");
  const imagePackageAffPerPackage = optionalNumber(raw.imagePackageAffPerPackage);
  const imagePackageRateLimit = optionalNumber(raw.imagePackageRateLimit);
  const imagePackagePriceUsd = optionalNumber(raw.imagePackagePriceUsd);
  if (imagePackageAffPerPackage !== undefined && (!Number.isFinite(imagePackageAffPerPackage) || imagePackageAffPerPackage <= 0 || imagePackageAffPerPackage > 1_000_000)) throw new Error("每包图包额度需为 0–1000000 之间的正数");
  if (imagePackageRateLimit !== undefined && (!Number.isInteger(imagePackageRateLimit) || imagePackageRateLimit <= 0 || imagePackageRateLimit > 1000)) throw new Error("图包每分钟限制需为 1–1000 张");
  if (imagePackagePriceUsd !== undefined && (!Number.isFinite(imagePackagePriceUsd) || imagePackagePriceUsd <= 0 || imagePackagePriceUsd > 100_000)) throw new Error("图包价格需为 0–100000 之间的正数");
  const dailyCheckInReward = optionalNumber(raw.dailyCheckInReward);
  const referralReward = optionalNumber(raw.referralReward);
  for (const [label, value] of [["签到奖励", dailyCheckInReward], ["邀请奖励", referralReward]] as const)
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100_000))
      throw new Error(`${label}需为 0–100000 之间的数字`);
  return {
    authProvider: authProvider as RuntimeSettings["authProvider"] | undefined,
    newApiBaseUrl: optionalString(raw.newApiBaseUrl),
    newApiAdminToken: optionalString(raw.newApiAdminToken),
    newApiAdminUserId: optionalString(raw.newApiAdminUserId),
    registerGroup: "default",
    quotaPerUnit,
    imagePackageAffPerPackage,
    imagePackageRateLimit,
    imagePackagePriceUsd,
    affGatewayUrl: optionalString(raw.affGatewayUrl),
    affGatewayToken: optionalString(raw.affGatewayToken),
    naiApiUrl: optionalString(raw.naiApiUrl),
    naiApiToken: optionalString(raw.naiApiToken),
    naiImageApiUrl: optionalString(raw.naiImageApiUrl),
    naiImageApiToken: optionalString(raw.naiImageApiToken),
    imageProviderUrl: optionalString(raw.imageProviderUrl),
    imageProviderToken: optionalString(raw.imageProviderToken),
    publicUrl: optionalString(raw.publicUrl),
    sourceCodeUrl: optionalString(raw.sourceCodeUrl),
    outboundProxy: optionalString(raw.outboundProxy),
    trustProxy: optionalBoolean(raw.trustProxy),
    cookieSecure: optionalBoolean(raw.cookieSecure),
    remoteHistoryUrl: optionalString(raw.remoteHistoryUrl),
    remoteHistoryToken: optionalString(raw.remoteHistoryToken),
    enableV5Models: optionalBoolean(raw.enableV5Models),
    enableV45Models: optionalBoolean(raw.enableV45Models),
    enableDailyCheckIn: optionalBoolean(raw.enableDailyCheckIn),
    enableReferral: optionalBoolean(raw.enableReferral),
    dailyCheckInReward,
    referralReward,
    watermarkEnabled: optionalBoolean(raw.watermarkEnabled),
    watermarkIssuer: optionalString(raw.watermarkIssuer),
    watermarkLabel: optionalString(raw.watermarkLabel),
    watermarkNote: optionalString(raw.watermarkNote),
  };
}

export function parseRuntimeEndpoint(
  raw: Record<string, unknown>,
  partial = false,
): Partial<EndpointConfig> {
  const type = optionalString(raw.type);
  const adapterType = optionalString(raw.adapterType);
  if (type && !ENDPOINT_TYPES.has(type)) throw new Error("端点类型不合法");
  if (adapterType && !ADAPTER_TYPES.has(adapterType)) throw new Error("适配器类型不合法");
  if (!partial && (!type || !adapterType || !optionalString(raw.name)?.trim()))
    throw new Error("请填写端点类型、适配器和名称");
  const configRaw = raw.config && typeof raw.config === "object" && !Array.isArray(raw.config)
    ? (raw.config as Record<string, unknown>)
    : {};
  return {
    id: optionalString(raw.id),
    type: type as EndpointConfig["type"] | undefined,
    adapterType,
    name: optionalString(raw.name),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    priority: optionalNumber(raw.priority),
    config: {
      baseUrl: optionalString(configRaw.baseUrl) ?? optionalString(raw.baseUrl),
      token: optionalString(configRaw.token) ?? optionalString(raw.token),
    },
  };
}