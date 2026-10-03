import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageProviderProtocol } from "@/lib/image-model-capabilities";

export type ProviderCapability = "image" | "text" | "both";
export type ProviderModel = { id: string; capabilities: ProviderCapability };
export type ProviderKind = "openai" | "novelai";

export type CustomProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  modelEntries?: ProviderModel[];
  /** Existing provider records omit this field and remain image-only. */
  capability?: ProviderCapability;
  protocol?: ImageProviderProtocol;
  discoveredModels?: string[];
  createdAt: string;
};

export type ProviderRecord = {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  secret: string;
  modelEntries: ProviderModel[];
  protocol?: ImageProviderProtocol;
  discoveredModels?: string[];
  createdAt: string;
};

export type PublicProvider = Omit<CustomProvider, "apiKey" | "discoveredModels"> & { hasKey: true; modelEntries: ProviderModel[] };
export type PublicRegistryEntry = Omit<ProviderRecord, "secret" | "discoveredModels"> & { hasKey: boolean; modelEntries: ProviderModel[]; discoveredModelCount: number };
export type StoryProvider = { id: string; kind: ProviderKind; name: string; model: string; baseUrl: string; secret: string };
export type PublicStoryProvider = Omit<StoryProvider, "secret"> & { hasKey: boolean };

type UnifiedStore = { version: 2; entries: ProviderRecord[] };
type LegacyImageStore = { version: 1; items: Array<Partial<CustomProvider>>; novelaiKey: string | null };
type LegacyStoryProvider = { id: string; kind: ProviderKind; name: string; model: string; baseUrl: string; encryptedKey: string };

const emptyStore = (): UnifiedStore => ({ version: 2, entries: [] });
const dataRoot = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"));
const root = () => path.join(dataRoot(), "providers");
const storePath = (userId: number) => path.join(root(), `${userId}.enc`);
const legacyStoryPath = (userId: number) => path.join(dataRoot(), "story-providers", `${userId}.json`);
const locks = new Map<number, Promise<unknown>>();

function encryptionKey(): Buffer {
  const secret = process.env.LFN_PROVIDER_ENCRYPTION_KEY || process.env.LFN_SESSION_SECRET ||
    (process.env.NODE_ENV === "production" ? "" : "lfn-development-secret-change-me");
  if (!secret || (process.env.NODE_ENV === "production" && Buffer.byteLength(secret) < 32))
    throw new Error("请配置至少 32 字节的 LFN_SESSION_SECRET 或 LFN_PROVIDER_ENCRYPTION_KEY");
  return createHash("sha256").update("lfn-personal-providers-v1\0").update(secret).digest();
}

function encrypt(value: UnifiedStore): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v2", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptRaw(raw: string): unknown {
  const [version, iv, tag, ciphertext] = raw.split(".");
  if ((version !== "v1" && version !== "v2") || !iv || !tag || !ciphertext) throw new Error("个人 API 配置数据损坏");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")) as unknown;
}

function legacyStoryKey(): Buffer {
  const secret = process.env.LFN_SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "lfn-development-secret-change-me");
  if (!secret || (process.env.NODE_ENV === "production" && Buffer.byteLength(secret) < 32))
    throw new Error("请配置至少 32 字节的 LFN_SESSION_SECRET 或 LFN_PROVIDER_ENCRYPTION_KEY");
  return createHash("sha256").update(secret).update("story-provider-secrets-v1").digest();
}

function decryptLegacyStory(value: string): string {
  const [iv, tag, bytes] = value.split(".");
  if (!iv || !tag || !bytes) throw new Error("故事模型源数据损坏");
  const decipher = createDecipheriv("aes-256-gcm", legacyStoryKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(bytes, "base64url")), decipher.final()]).toString("utf8");
}

function toModelEntries(models: unknown, entries: unknown, fallback: ProviderCapability): ProviderModel[] {
  const source = Array.isArray(entries) ? entries : Array.isArray(models) ? models.map((id) => ({ id, capabilities: fallback })) : [];
  return [...new Map(source.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim()) return [];
    const capabilities = item.capabilities === "both" || item.capabilities === "text" ? item.capabilities : fallback;
    return [[item.id.trim(), { id: item.id.trim(), capabilities }] as const];
  })).values()];
}

function normalizeLegacy(value: unknown): UnifiedStore {
  const legacy = value as LegacyImageStore;
  const entries: ProviderRecord[] = (Array.isArray(legacy.items) ? legacy.items : []).flatMap((item) => {
    if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.baseUrl !== "string" || typeof item.apiKey !== "string") return [];
    return [{ id: item.id, kind: "openai" as const, name: item.name, baseUrl: item.baseUrl, secret: item.apiKey,
      modelEntries: toModelEntries(item.models, item.modelEntries, item.capability === "text" || item.capability === "both" ? item.capability : "image"),
      discoveredModels: Array.isArray(item.discoveredModels) ? item.discoveredModels.filter((id): id is string => typeof id === "string") : undefined,
      protocol: item.protocol, createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString() }];
  });
  if (typeof legacy.novelaiKey === "string" && legacy.novelaiKey)
    entries.push({ id: "novelai", kind: "novelai", name: "NovelAI", baseUrl: "https://image.novelai.net", secret: legacy.novelaiKey, modelEntries: [], createdAt: new Date().toISOString() });
  return { version: 2, entries };
}

async function readLegacyStories(userId: number): Promise<ProviderRecord[]> {
  try {
    const value: unknown = JSON.parse(await readFile(legacyStoryPath(userId), "utf8"));
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw) => {
      const item = raw as Partial<LegacyStoryProvider>;
      if (!item.id || !item.name || !item.model || !item.kind || !item.baseUrl || !item.encryptedKey) return [];
      try {
        return [{ id: item.id, kind: item.kind, name: item.name, baseUrl: item.baseUrl, secret: decryptLegacyStory(item.encryptedKey), modelEntries: [{ id: item.model, capabilities: "text" }], createdAt: new Date().toISOString() }];
      } catch { return []; }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function read(userId: number): Promise<UnifiedStore> {
  let store: UnifiedStore;
  let changed = false;
  try {
    const parsed = decryptRaw(await readFile(storePath(userId), "utf8"));
    if ((parsed as UnifiedStore).version === 2 && Array.isArray((parsed as UnifiedStore).entries)) store = parsed as UnifiedStore;
    else { store = normalizeLegacy(parsed); changed = true; }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    store = emptyStore();
  }
  const additions = (await readLegacyStories(userId)).filter((item) => !store.entries.some((current) => current.id === item.id));
  if (additions.length) { store.entries.push(...additions); changed = true; }
  if (changed) await write(userId, store);
  if (additions.length) await unlink(legacyStoryPath(userId)).catch(() => undefined);
  return store;
}

async function write(userId: number, value: UnifiedStore): Promise<void> {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const target = storePath(userId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, encrypt(value), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function withLock<T>(userId: number, task: () => Promise<T>): Promise<T> {
  const current = (locks.get(userId) ?? Promise.resolve()).then(task, task);
  const tail = current.catch(() => undefined);
  locks.set(userId, tail);
  void tail.then(() => { if (locks.get(userId) === tail) locks.delete(userId); });
  return current;
}

function toLegacyProvider(item: ProviderRecord, capability: "image" | "text" = "image"): CustomProvider {
  return { id: item.id, name: item.name, baseUrl: item.baseUrl, apiKey: item.secret,
    models: item.modelEntries.filter((model) => model.capabilities === capability || model.capabilities === "both").map((model) => model.id),
    modelEntries: item.modelEntries, discoveredModels: item.discoveredModels, createdAt: item.createdAt, protocol: item.protocol };
}

export const publicProvider = (item: CustomProvider | ProviderRecord): PublicProvider => {
  const record = "secret" in item ? item : { ...item, secret: item.apiKey, kind: "openai" as const,
    modelEntries: item.modelEntries || toModelEntries(item.models, undefined, item.capability || "image") };
  const legacy = toLegacyProvider(record);
  return { id: legacy.id, name: legacy.name, baseUrl: legacy.baseUrl, models: legacy.models,
    modelEntries: record.modelEntries, createdAt: legacy.createdAt, hasKey: true, protocol: legacy.protocol,
    capability: record.modelEntries.some((model) => model.capabilities === "both") ? "both" : record.modelEntries.every((model) => model.capabilities === "text") ? "text" : "image" };
};

export function providerSupportsCapability(provider: Pick<CustomProvider, "capability" | "modelEntries" | "models">, capability: ProviderCapability): boolean {
  if (provider.modelEntries?.length) return provider.modelEntries.some((model) => model.capabilities === capability || model.capabilities === "both");
  const current = provider.capability ?? "image";
  return current === capability || current === "both";
}

export async function listRegistryEntries(userId: number, capability?: ProviderCapability): Promise<ProviderRecord[]> {
  const entries = (await read(userId)).entries;
  return capability ? entries.filter((entry) => entry.modelEntries.some((model) => model.capabilities === capability || model.capabilities === "both")) : entries;
}

export function publicRegistryEntry(item: ProviderRecord, capability?: ProviderCapability): PublicRegistryEntry {
  const entries = capability
    ? item.modelEntries.filter((model) => model.capabilities === capability || model.capabilities === "both")
    : item.modelEntries;
  return { id: item.id, kind: item.kind, name: item.name, baseUrl: item.baseUrl, modelEntries: entries,
    protocol: item.protocol, createdAt: item.createdAt, hasKey: Boolean(item.secret), discoveredModelCount: item.discoveredModels?.length || 0 };
}

export async function listPublicRegistryEntries(userId: number, capability?: ProviderCapability): Promise<PublicRegistryEntry[]> {
  return (await listRegistryEntries(userId, capability)).map((item) => publicRegistryEntry(item, capability));
}

export async function getRegistryEntry(userId: number, id: string): Promise<ProviderRecord | null> {
  return (await read(userId)).entries.find((entry) => entry.id === id) ?? null;
}

export async function saveRegistryEntry(userId: number, input: Omit<ProviderRecord, "id" | "createdAt"> & { id?: string; createdAt?: string }): Promise<ProviderRecord> {
  return withLock(userId, async () => {
    const store = await read(userId);
    const existing = input.id ? store.entries.find((entry) => entry.id === input.id) : undefined;
    if (input.id && !existing) throw new Error("模型源不存在");
    if (!existing && store.entries.length >= 20) throw new Error("最多保存 20 个模型源");
    const entry: ProviderRecord = { ...input, id: existing?.id || randomUUID(), createdAt: existing?.createdAt || input.createdAt || new Date().toISOString() };
    if (existing) store.entries[store.entries.indexOf(existing)] = entry; else store.entries.push(entry);
    await write(userId, store);
    return entry;
  });
}

export async function listProviders(userId: number): Promise<PublicProvider[]> {
  // Legacy image UI lists newly saved providers before remote model discovery completes.
  return (await listRegistryEntries(userId)).filter((item) => item.kind === "openai" &&
    (!item.modelEntries.length || item.modelEntries.some((model) => model.capabilities === "image" || model.capabilities === "both"))).map(publicProvider);
}

export async function getProvider(userId: number, id: string): Promise<CustomProvider | null> {
  const item = await getRegistryEntry(userId, id);
  return item && item.kind === "openai" &&
    (!item.modelEntries.length || item.modelEntries.some((model) => model.capabilities === "image" || model.capabilities === "both"))
    ? toLegacyProvider(item) : null;
}

export async function listTextProviders(userId: number): Promise<CustomProvider[]> {
  return (await listRegistryEntries(userId, "text")).map((item) => toLegacyProvider(item, "text"));
}

export async function resolveTextProviderModel(userId: number, providerId: string, modelId?: string): Promise<{ provider: CustomProvider; model: string } | null> {
  const provider = (await listTextProviders(userId)).find((item) => item.id === providerId);
  if (!provider) return null;
  const eligible = provider.modelEntries?.filter((entry) => entry.capabilities === "text" || entry.capabilities === "both") || [];
  const selected = modelId ? eligible.find((entry) => entry.id === modelId)?.id : eligible[0]?.id;
  return selected ? { provider, model: selected } : null;
}

export async function rememberDiscoveredModels(userId: number, id: string, models: string[]): Promise<boolean> {
  return withLock(userId, async () => {
    const store = await read(userId);
    const provider = store.entries.find((item) => item.id === id);
    if (!provider) return false;
    const next = [...new Set(models)];
    provider.discoveredModels = next;
    const known = new Set(provider.modelEntries.map((model) => model.id));
    for (const model of next) if (!known.has(model)) provider.modelEntries.push({ id: model, capabilities: "image" });
    await write(userId, store);
    return true;
  });
}

export async function addProvider(userId: number, input: Omit<CustomProvider, "id" | "createdAt">): Promise<PublicProvider> {
  const item = await saveRegistryEntry(userId, { kind: "openai", name: input.name, baseUrl: input.baseUrl, secret: input.apiKey,
    modelEntries: input.modelEntries || toModelEntries(input.models, undefined, input.capability || "image"), discoveredModels: input.discoveredModels, protocol: input.protocol });
  return publicProvider(item);
}

export async function deleteProvider(userId: number, id: string): Promise<boolean> {
  return withLock(userId, async () => {
    const store = await read(userId);
    const before = store.entries.length;
    store.entries = store.entries.filter((item) => item.id !== id);
    if (store.entries.length === before) return false;
    await write(userId, store);
    return true;
  });
}

export async function getNovelaiKey(userId: number): Promise<string | null> {
  return (await getRegistryEntry(userId, "novelai"))?.secret ?? null;
}

export async function setNovelaiKey(userId: number, key: string | null): Promise<void> {
  await withLock(userId, async () => {
    const store = await read(userId);
    const index = store.entries.findIndex((item) => item.id === "novelai");
    if (!key) { if (index >= 0) store.entries.splice(index, 1); }
    else {
      const entry: ProviderRecord = { id: "novelai", kind: "novelai", name: "NovelAI", baseUrl: "https://image.novelai.net", secret: key, modelEntries: [], createdAt: index >= 0 ? store.entries[index].createdAt : new Date().toISOString() };
      if (index >= 0) store.entries[index] = entry; else store.entries.push(entry);
    }
    await write(userId, store);
  });
}

function storyPublic(item: ProviderRecord): PublicStoryProvider {
  const model = item.modelEntries.find((entry) => entry.capabilities === "text" || entry.capabilities === "both")?.id || "";
  return { id: item.id, kind: item.kind, name: item.name, model, baseUrl: item.baseUrl, hasKey: Boolean(item.secret) };
}

export async function listStoryProviders(userId: number): Promise<PublicStoryProvider[]> {
  return (await listRegistryEntries(userId, "text")).map(storyPublic);
}

export async function findStoryProvider(userId: number, id: string): Promise<StoryProvider | null> {
  const item = await getRegistryEntry(userId, id);
  if (!item) return null;
  const model = item.modelEntries.find((entry) => entry.capabilities === "text" || entry.capabilities === "both")?.id;
  return model ? { id: item.id, kind: item.kind, name: item.name, model, baseUrl: item.baseUrl, secret: item.secret } : null;
}

export async function saveStoryProvider(userId: number, input: Pick<StoryProvider, "kind" | "name" | "model" | "baseUrl"> & { key?: string; id?: string }): Promise<PublicStoryProvider> {
  const existing = input.id ? await getRegistryEntry(userId, input.id) : null;
  if (input.id && !existing) throw new Error("模型源不存在");
  const secret = input.key || existing?.secret || "";
  if (!secret) throw new Error("请输入 API Key");
  const entry = await saveRegistryEntry(userId, { id: input.id, kind: input.kind, name: input.name, baseUrl: input.baseUrl,
    secret, modelEntries: [{ id: input.model, capabilities: "text" }] });
  return storyPublic(entry);
}

export async function listStoryProviderRecords(userId: number): Promise<ProviderRecord[]> { return listRegistryEntries(userId, "text"); }
export async function deleteStoryProvider(userId: number, id: string): Promise<boolean> { return deleteProvider(userId, id); }
