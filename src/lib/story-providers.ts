import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateSessionConfiguration } from "@/lib/session";

export type StoryProvider = {
  id: string;
  kind: "openai" | "novelai";
  name: string;
  model: string;
  baseUrl: string;
  secret: string;
};

export type PublicStoryProvider = Omit<StoryProvider, "secret"> & { hasKey: boolean };

const root = () => path.resolve(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "story-providers");
const file = (userId: number) => path.join(root(), `${userId}.json`);
const locks = new Map<number, Promise<unknown>>();

function encryptionKey(): Buffer {
  validateSessionConfiguration();
  return createHash("sha256").update(process.env.LFN_SESSION_SECRET || "lfn-development-secret-change-me").update("story-provider-secrets-v1").digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map((part) => part.toString("base64url")).join(".");
}

function decrypt(value: string): string {
  const [iv, tag, bytes] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(bytes, "base64url")), decipher.final()]).toString("utf8");
}

type StoredProvider = Omit<StoryProvider, "secret"> & { encryptedKey: string };

async function read(userId: number): Promise<StoredProvider[]> {
  try {
    const data: unknown = JSON.parse(await readFile(file(userId), "utf8"));
    return Array.isArray(data) ? data.filter((entry): entry is StoredProvider =>
      entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.encryptedKey === "string") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function write(userId: number, providers: StoredProvider[]): Promise<void> {
  await mkdir(root(), { recursive: true });
  const target = file(userId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(providers), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

function locked<T>(userId: number, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(userId) || Promise.resolve();
  const current = previous.then(action, action);
  const settled = current.then(() => undefined, () => undefined);
  locks.set(userId, settled);
  void settled.then(() => { if (locks.get(userId) === settled) locks.delete(userId); });
  return current;
}

export function publicProvider(provider: StoredProvider): PublicStoryProvider {
  const { encryptedKey, ...info } = provider;
  return { ...info, hasKey: Boolean(encryptedKey) };
}

export async function listStoryProviders(userId: number): Promise<PublicStoryProvider[]> {
  return (await read(userId)).map(publicProvider);
}

export async function findStoryProvider(userId: number, id: string): Promise<StoryProvider | null> {
  const provider = (await read(userId)).find((item) => item.id === id);
  return provider ? { ...publicProvider(provider), secret: decrypt(provider.encryptedKey) } : null;
}

export async function saveStoryProvider(userId: number, input: Pick<StoryProvider, "kind" | "name" | "model" | "baseUrl"> & { key?: string; id?: string }): Promise<PublicStoryProvider> {
  return locked(userId, async () => {
    const entries = await read(userId);
    const existing = input.id ? entries.find((item) => item.id === input.id) : undefined;
    if (input.id && !existing) throw new Error("模型源不存在");
    if (!existing && entries.length >= 20) throw new Error("最多保存 20 个模型源");
    const entry: StoredProvider = {
      id: existing?.id || randomUUID(),
      kind: input.kind,
      name: input.name,
      model: input.model,
      baseUrl: input.baseUrl,
      encryptedKey: input.key ? encrypt(input.key) : existing?.encryptedKey || "",
    };
    if (!entry.encryptedKey) throw new Error("请输入 API Key");
    if (existing) entries[entries.indexOf(existing)] = entry;
    else entries.push(entry);
    await write(userId, entries);
    return publicProvider(entry);
  });
}

export async function deleteStoryProvider(userId: number, id: string): Promise<boolean> {
  return locked(userId, async () => {
    const entries = await read(userId);
    const next = entries.filter((item) => item.id !== id);
    if (next.length === entries.length) return false;
    await write(userId, next);
    return true;
  });
}