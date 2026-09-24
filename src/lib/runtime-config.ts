import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EndpointConfig } from "@/lib/adapters/types";

export type AuthProviderId = "newapi" | "local";

// 模型计费覆盖：auto = 内置公式（面积/步数），fixed = 固定 AFF/张（0 = 免费）。
export type ModelBillingMode = "auto" | "fixed";
export type ModelBillingEntry = { mode: ModelBillingMode; fixedCost: number };
export type ModelBillingMap = Record<string, ModelBillingEntry>;

export type RuntimeSettings = {
  authProvider: AuthProviderId;
  newApiBaseUrl: string;
  newApiAdminToken: string;
  newApiAdminUserId: string;
  registerGroup: string;
  quotaPerUnit: number;
  affGatewayUrl: string;
  affGatewayToken: string;
  naiApiUrl: string;
  naiApiToken: string;
  naiImageApiUrl: string;
  naiImageApiToken: string;
  imageProviderUrl: string;
  imageProviderToken: string;
  publicUrl: string;
  sourceCodeUrl: string;
  outboundProxy: string;
  trustProxy: boolean;
  cookieSecure: boolean;
  remoteHistoryUrl: string;
  remoteHistoryToken: string;
};

export type RuntimeConfigStore = {
  settings: RuntimeSettings;
  endpoints: EndpointConfig[];
  modelBilling: ModelBillingMap;
};

export const LFN_MODEL_GROUP = "ikun" as const;

const SECRET_KEYS = new Set([
  "newApiAdminToken",
  "affGatewayToken",
  "naiApiToken",
  "naiImageApiToken",
  "imageProviderToken",
  "remoteHistoryToken",
]);

const EMPTY_SETTINGS: RuntimeSettings = {
  authProvider: "newapi",
  newApiBaseUrl: "",
  newApiAdminToken: "",
  newApiAdminUserId: "1",
  registerGroup: LFN_MODEL_GROUP,
  quotaPerUnit: 500000,
  affGatewayUrl: "",
  affGatewayToken: "",
  naiApiUrl: "",
  naiApiToken: "",
  naiImageApiUrl: "",
  naiImageApiToken: "",
  imageProviderUrl: "",
  imageProviderToken: "",
  publicUrl: "",
  sourceCodeUrl: "",
  outboundProxy: "",
  trustProxy: false,
  cookieSecure: false,
  remoteHistoryUrl: "",
  remoteHistoryToken: "",
};

let lock: Promise<unknown> = Promise.resolve();
let cached: RuntimeConfigStore | null = null;

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const current = lock.then(task, task);
  lock = current.catch(() => undefined);
  return current;
}

const storeRoot = () =>
  path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "platform");
const storePath = () => path.join(storeRoot(), "config.json");

function envSettings(): RuntimeSettings {
  const quota = Number(process.env.QUOTA_PER_UNIT || 500000);
  const auth = process.env.LFN_AUTH_PROVIDER?.trim().toLowerCase();
  return {
    authProvider: auth === "local" ? "local" : "newapi",
    newApiBaseUrl: process.env.NEWAPI_BASE_URL?.trim() || "",
    newApiAdminToken: process.env.LFN_ADMIN_TOKEN?.trim() || "",
    newApiAdminUserId: process.env.LFN_ADMIN_USER_ID?.trim() || "1",
    registerGroup: LFN_MODEL_GROUP,
    quotaPerUnit: Number.isFinite(quota) && quota > 0 ? quota : 500000,
    affGatewayUrl: process.env.LFN_AFF_GATEWAY_URL?.trim() || "",
    affGatewayToken: process.env.LFN_AFF_GATEWAY_TOKEN?.trim() || "",
    naiApiUrl: process.env.LFN_NAI_API_URL?.trim() || "",
    naiApiToken: process.env.LFN_NAI_API_TOKEN?.trim() || "",
    naiImageApiUrl: process.env.LFN_NAI_IMAGE_API_URL?.trim() || "",
    naiImageApiToken: process.env.LFN_NAI_IMAGE_API_TOKEN?.trim() || "",
    imageProviderUrl: process.env.LFN_IMAGE_PROVIDER_URL?.trim() || "",
    imageProviderToken: process.env.LFN_IMAGE_PROVIDER_TOKEN?.trim() || "",
    publicUrl: process.env.LFN_PUBLIC_URL?.trim() || "",
    sourceCodeUrl: process.env.SOURCE_CODE_URL?.trim() || "",
    outboundProxy: process.env.LFN_OUTBOUND_PROXY?.trim() || "",
    trustProxy: process.env.LFN_TRUST_PROXY === "true",
    cookieSecure: process.env.LFN_COOKIE_SECURE === "true",
    remoteHistoryUrl: process.env.LFN_REMOTE_HISTORY_URL?.trim() || "",
    remoteHistoryToken: process.env.LFN_REMOTE_HISTORY_TOKEN?.trim() || "",
  };
}

function mergeSettings(saved?: Partial<RuntimeSettings> | null): RuntimeSettings {
  const fallback = envSettings();
  const next = { ...fallback };
  if (!saved) return next;
  for (const key of Object.keys(EMPTY_SETTINGS) as Array<keyof RuntimeSettings>) {
    const value = saved[key];
    if (value === undefined || value === null) continue;
    if (typeof fallback[key] === "boolean") next[key] = Boolean(value) as never;
    else if (typeof fallback[key] === "number") {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) next[key] = number as never;
    } else if (typeof value === "string") next[key] = value.trim() as never;
  }
  if (next.authProvider !== "local") next.authProvider = "newapi";
  next.registerGroup = LFN_MODEL_GROUP;
  return next;
}

function normalizeEndpoint(raw: Partial<EndpointConfig>, fallback?: EndpointConfig): EndpointConfig {
  const now = new Date().toISOString();
  const type = raw.type === "auth" || raw.type === "image" || raw.type === "wallet" ? raw.type : fallback?.type;
  if (!type) throw new Error("端点类型不合法");
  const adapterType = String(raw.adapterType || fallback?.adapterType || "").trim();
  if (!adapterType) throw new Error("缺少适配器类型");
  const name = String(raw.name || fallback?.name || "").trim().slice(0, 80);
  if (!name) throw new Error("请填写端点名称");
  const config = {
    ...(fallback?.config || {}),
    ...(raw.config && typeof raw.config === "object" ? raw.config : {}),
  };
  return {
    id: String(raw.id || fallback?.id || randomUUID()),
    type,
    adapterType,
    name,
    enabled: raw.enabled ?? fallback?.enabled ?? true,
    config,
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : fallback?.priority ?? 50,
    createdAt: fallback?.createdAt || now,
    updatedAt: now,
  };
}

function defaultEndpoints(settings: RuntimeSettings): EndpointConfig[] {
  const now = new Date().toISOString();
  const items: EndpointConfig[] = [];
  if (settings.authProvider === "local") {
    items.push({
      id: "local-auth",
      type: "auth",
      adapterType: "local",
      name: "本地账号",
      enabled: true,
      config: {},
      priority: 80,
      createdAt: now,
      updatedAt: now,
    });
  } else if (settings.newApiBaseUrl) {
    items.push({
      id: "newapi-auth",
      type: "auth",
      adapterType: "newapi",
      name: "NewAPI 账号",
      enabled: true,
      config: { baseUrl: settings.newApiBaseUrl, token: settings.newApiAdminToken },
      priority: 100,
      createdAt: now,
      updatedAt: now,
    });
    items.push({
      id: "newapi-wallet",
      type: "wallet",
      adapterType: "newapi",
      name: "NewAPI 余额",
      enabled: true,
      config: { baseUrl: settings.newApiBaseUrl, token: settings.newApiAdminToken },
      priority: 100,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (settings.affGatewayUrl && settings.affGatewayToken) {
    items.push({
      id: "gateway-image",
      type: "image",
      adapterType: "gateway",
      name: "NovelAI Gateway",
      enabled: true,
      config: { baseUrl: settings.affGatewayUrl, token: settings.affGatewayToken },
      priority: 100,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (settings.imageProviderUrl && settings.imageProviderToken) {
    items.push({
      id: "generic-image",
      type: "image",
      adapterType: "openai_compat",
      name: "OpenAI 兼容图像接口",
      enabled: true,
      config: { baseUrl: settings.imageProviderUrl, token: settings.imageProviderToken },
      priority: 90,
      createdAt: now,
      updatedAt: now,
    });
  }
  return items;
}

function normalizeModelBilling(raw: unknown): ModelBillingMap {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const result: ModelBillingMap = {};
  for (const [model, value] of Object.entries(source)) {
    const name = String(model || "").trim();
    if (!name || !value || typeof value !== "object") continue;
    const entry = value as Partial<ModelBillingEntry>;
    if (entry.mode !== "auto" && entry.mode !== "fixed") continue;
    const fixedCost = Number(entry.fixedCost);
    result[name] = {
      mode: entry.mode,
      fixedCost: Number.isFinite(fixedCost) && fixedCost >= 0 ? fixedCost : 0,
    };
  }
  return result;
}

async function readStore(): Promise<RuntimeConfigStore> {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8")) as Partial<RuntimeConfigStore>;
    const settings = mergeSettings(parsed.settings);
    const endpoints = Array.isArray(parsed.endpoints)
      ? parsed.endpoints.map((item) => normalizeEndpoint(item))
      : defaultEndpoints(settings);
    cached = { settings, endpoints, modelBilling: normalizeModelBilling(parsed.modelBilling) };
  } catch {
    const settings = envSettings();
    cached = { settings, endpoints: defaultEndpoints(settings), modelBilling: {} };
  }
  return cached;
}

async function writeStore(store: RuntimeConfigStore): Promise<void> {
  await mkdir(storeRoot(), { recursive: true });
  const temp = `${storePath()}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await rename(temp, storePath());
  cached = store;
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  return (await readStore()).settings;
}

export async function getRuntimeEndpoints(): Promise<EndpointConfig[]> {
  return (await readStore()).endpoints;
}

export async function getEnabledRuntimeEndpoints(): Promise<EndpointConfig[]> {
  return (await getRuntimeEndpoints())
    .filter((item) => item.enabled)
    .sort((a, b) => b.priority - a.priority);
}

export async function updateRuntimeSettings(
  patch: Partial<RuntimeSettings>,
): Promise<RuntimeSettings> {
  return withLock(async () => {
    const store = await readStore();
    const cleaned = { ...patch };
    for (const key of SECRET_KEYS) {
      const value = cleaned[key as keyof RuntimeSettings];
      if (typeof value === "string" && isMaskedSecret(value))
        delete cleaned[key as keyof RuntimeSettings];
    }
    store.settings = mergeSettings({ ...store.settings, ...cleaned });
    await writeStore(store);
    return store.settings;
  });
}

export async function upsertRuntimeEndpoint(
  input: Partial<EndpointConfig>,
): Promise<EndpointConfig> {
  return withLock(async () => {
    const store = await readStore();
    const existing = input.id ? store.endpoints.find((item) => item.id === input.id) : undefined;
    if (input.config && isMaskedSecret(input.config.token)) {
      input = {
        ...input,
        config: { ...input.config, token: existing?.config.token },
      };
    }
    const endpoint = normalizeEndpoint(input, existing);
    if (existing)
      store.endpoints = store.endpoints.map((item) => (item.id === existing.id ? endpoint : item));
    else store.endpoints.push(endpoint);
    await writeStore(store);
    return endpoint;
  });
}

export async function deleteRuntimeEndpoint(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.endpoints.length;
    store.endpoints = store.endpoints.filter((item) => item.id !== id);
    if (store.endpoints.length === before) return false;
    await writeStore(store);
    return true;
  });
}

export async function getModelBilling(): Promise<ModelBillingMap> {
  return (await readStore()).modelBilling;
}

export async function updateModelBilling(map: ModelBillingMap): Promise<ModelBillingMap> {
  return withLock(async () => {
    const store = await readStore();
    store.modelBilling = normalizeModelBilling(map);
    await writeStore(store);
    return store.modelBilling;
  });
}

// 命中 fixed 模型时返回「每张固定 AFF」，否则 null 走内置公式。
export async function runtimeModelFixedCost(model: string): Promise<number | null> {
  const entry = (await getModelBilling())[model];
  if (!entry || entry.mode !== "fixed") return null;
  const cost = Number(entry.fixedCost);
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function maskSecret(value: string | undefined): string {
  const text = value?.trim() || "";
  if (!text) return "";
  if (text.length <= 8) return "••••";
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

export function isMaskedSecret(value: string | undefined): boolean {
  return Boolean(value?.includes("••••"));
}

export function publicSettings(settings: RuntimeSettings): RuntimeSettings {
  const next = { ...settings };
  for (const key of SECRET_KEYS) {
    (next as Record<string, unknown>)[key] = maskSecret(String(settings[key as keyof RuntimeSettings] || ""));
  }
  return next;
}

export function publicEndpoint(endpoint: EndpointConfig): EndpointConfig {
  return {
    ...endpoint,
    config: {
      ...endpoint.config,
      token: maskSecret(endpoint.config.token),
      apiKey: maskSecret(endpoint.config.apiKey),
      secretKey: maskSecret(endpoint.config.secretKey),
    },
  };
}

export function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export async function runtimeAuthProvider(): Promise<AuthProviderId> {
  return (await getRuntimeSettings()).authProvider;
}

export async function runtimeNewApiBaseUrl(): Promise<string> {
  const settings = await getRuntimeSettings();
  return settings.newApiBaseUrl || "http://127.0.0.1:3000";
}

export async function runtimeAdminToken(): Promise<string | null> {
  const token = (await getRuntimeSettings()).newApiAdminToken.trim();
  return token || null;
}

function endpointUpstream(endpoint: EndpointConfig | undefined): { baseUrl: string; token: string } | null {
  const baseUrl = endpoint?.config.baseUrl?.trim().replace(/\/+$/, "") || "";
  const token = endpoint?.config.token?.trim() || "";
  return baseUrl && token ? { baseUrl, token } : null;
}

export async function runtimeImageEndpoint(): Promise<EndpointConfig | null> {
  const endpoints = await getEnabledRuntimeEndpoints();
  return endpoints.find((item) => item.type === "image") || null;
}

export async function runtimeImageUpstream(): Promise<{
  baseUrl: string;
  token: string;
  adapterType: string;
} | null> {
  const endpoint = await runtimeImageEndpoint();
  const upstream = endpointUpstream(endpoint || undefined);
  if (!upstream) return null;
  return { ...upstream, adapterType: endpoint?.adapterType || "openai_compat" };
}

export async function runtimeAffGateway(): Promise<{ baseUrl: string; token: string } | null> {
  const endpoint = await runtimeImageEndpoint();
  if (endpoint) {
    if (endpoint.adapterType !== "gateway") return null;
    return endpointUpstream(endpoint);
  }
  const settings = await getRuntimeSettings();
  const baseUrl = settings.affGatewayUrl.trim().replace(/\/+$/, "");
  const token = settings.affGatewayToken.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

export async function runtimeGenericImage(): Promise<{ baseUrl: string; token: string } | null> {
  const endpoint = await runtimeImageEndpoint();
  if (endpoint) {
    if (endpoint.adapterType === "gateway") return null;
    return endpointUpstream(endpoint);
  }
  const settings = await getRuntimeSettings();
  const baseUrl = settings.imageProviderUrl.trim().replace(/\/+$/, "");
  const token = settings.imageProviderToken.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

function trimUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, "").replace(/\/v1$/i, "") || "";
}

export type NaiNativeUpstream = {
  baseUrl: string;
  token: string;
};

export async function runtimeNaiAccountUpstream(): Promise<NaiNativeUpstream | null> {
  const settings = await getRuntimeSettings();
  const baseUrl = trimUrl(settings.naiApiUrl) || trimUrl(settings.affGatewayUrl);
  const token = settings.naiApiToken.trim() || settings.affGatewayToken.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

export async function runtimeNaiImageUpstream(): Promise<NaiNativeUpstream | null> {
  const settings = await getRuntimeSettings();
  const imageUrl = trimUrl(settings.naiImageApiUrl);
  const imageToken = settings.naiImageApiToken.trim();
  if (imageUrl && imageToken) return { baseUrl: imageUrl, token: imageToken };
  if (imageUrl) {
    const fallbackToken = settings.naiApiToken.trim() || settings.affGatewayToken.trim();
    if (fallbackToken) return { baseUrl: imageUrl, token: fallbackToken };
  }
  return runtimeNaiAccountUpstream();
}

export async function runtimeQuotaPerUnit(): Promise<number> {
  return (await getRuntimeSettings()).quotaPerUnit;
}

export async function runtimeRegisterGroup(): Promise<string> {
  return LFN_MODEL_GROUP;
}

export async function runtimeRemoteHistory(): Promise<{ baseUrl: string; token: string } | null> {
  const settings = await getRuntimeSettings();
  const baseUrl = settings.remoteHistoryUrl.trim().replace(/\/+$/, "");
  const token = settings.remoteHistoryToken.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}

export function resetRuntimeConfigCache(): void {
  cached = null;
}
