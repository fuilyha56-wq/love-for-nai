import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageProviderProtocol } from "@/lib/image-model-capabilities";

export type CustomProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  protocol?: ImageProviderProtocol;
  discoveredModels?: string[];
  createdAt: string;
};

type UserProviders = { version: 1; items: CustomProvider[]; novelaiKey: string | null };
export type PublicProvider = Omit<CustomProvider, "apiKey" | "discoveredModels"> & { hasKey: true };

const emptyStore = (): UserProviders => ({ version: 1, items: [], novelaiKey: null });
const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "providers");
const storePath = (userId: number) => path.join(root(), `${userId}.enc`);
const locks = new Map<number, Promise<unknown>>();

function encryptionKey(): Buffer {
  const secret = process.env.LFN_PROVIDER_ENCRYPTION_KEY || process.env.LFN_SESSION_SECRET ||
    (process.env.NODE_ENV === "production" ? "" : "lfn-development-secret-change-me");
  if (!secret || (process.env.NODE_ENV === "production" && Buffer.byteLength(secret) < 32))
    throw new Error("请配置至少 32 字节的 LFN_SESSION_SECRET 或 LFN_PROVIDER_ENCRYPTION_KEY");
  return createHash("sha256").update("lfn-personal-providers-v1\0").update(secret).digest();
}

function encrypt(value: UserProviders): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decrypt(raw: string): UserProviders {
  const [version, iv, tag, ciphertext] = raw.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("个人 API 配置数据损坏");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")) as UserProviders;
  if (parsed.version !== 1 || !Array.isArray(parsed.items)) throw new Error("个人 API 配置数据格式无效");
  return parsed;
}

async function read(userId: number): Promise<UserProviders> {
  try {
    return decrypt(await readFile(storePath(userId), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function write(userId: number, value: UserProviders): Promise<void> {
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

export const publicProvider = (item: CustomProvider): PublicProvider => ({
  id: item.id, name: item.name, baseUrl: item.baseUrl, models: item.models,
  createdAt: item.createdAt, hasKey: true, protocol: item.protocol ?? "auto",
});

export async function listProviders(userId: number): Promise<PublicProvider[]> {
  return (await read(userId)).items.map(publicProvider);
}

export async function getProvider(userId: number, id: string): Promise<CustomProvider | null> {
  return (await read(userId)).items.find((item) => item.id === id) ?? null;
}

export async function rememberDiscoveredModels(userId: number, id: string, models: string[]): Promise<boolean> {
  return withLock(userId, async () => {
    const store = await read(userId);
    const provider = store.items.find((item) => item.id === id);
    if (!provider) return false;
    const next = [...new Set(models)];
    if (JSON.stringify(provider.discoveredModels ?? []) === JSON.stringify(next)) return true;
    provider.discoveredModels = next;
    await write(userId, store);
    return true;
  });
}

export async function addProvider(userId: number, input: Omit<CustomProvider, "id" | "createdAt">): Promise<PublicProvider> {
  return withLock(userId, async () => {
    const store = await read(userId);
    if (store.items.length >= 20) throw new RangeError("最多保存 20 个第三方 API 配置");
    const item = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    store.items.push(item);
    await write(userId, store);
    return publicProvider(item);
  });
}

export async function deleteProvider(userId: number, id: string): Promise<boolean> {
  return withLock(userId, async () => {
    const store = await read(userId);
    const before = store.items.length;
    store.items = store.items.filter((item) => item.id !== id);
    if (store.items.length === before) return false;
    await write(userId, store);
    return true;
  });
}

export async function getNovelaiKey(userId: number): Promise<string | null> {
  return (await read(userId)).novelaiKey ?? null;
}

export async function setNovelaiKey(userId: number, key: string | null): Promise<void> {
  await withLock(userId, async () => {
    const store = await read(userId);
    store.novelaiKey = key;
    await write(userId, store);
  });
}
