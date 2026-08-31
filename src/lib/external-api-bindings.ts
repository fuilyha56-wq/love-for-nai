import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { newApiBaseUrl } from "@/lib/newapi";

export type ExternalApiBinding = {
  fingerprint: string;
  userId: number;
  createdAt: string;
  lastUsedAt: string;
};

type BindingStore = { bindings: ExternalApiBinding[] };

const bindingLocks = new Map<number, Promise<unknown>>();
const bindingRoot = () =>
  path.resolve(
    process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"),
    "external-api",
  );
const bindingPath = (userId: number) =>
  path.join(bindingRoot(), `${userId}.json`);

function bindingSecret(): string {
  // 不复用 session secret，避免一个泄露点同时影响会话和 API key 指纹。
  return (
    process.env.LFN_EXTERNAL_API_KEY_SECRET?.trim() ||
    process.env.LFN_SESSION_SECRET?.trim() ||
    "lfn-external-api-key-development-secret"
  );
}

export function externalApiKeyFingerprint(authorization: string): string {
  const key = authorization.replace(/^Bearer\s+/i, "").trim();
  return createHmac("sha256", bindingSecret()).update(key).digest("hex");
}

async function readBindings(userId: number): Promise<ExternalApiBinding[]> {
  try {
    const raw = JSON.parse(await readFile(bindingPath(userId), "utf8")) as
      | BindingStore
      | undefined;
    return Array.isArray(raw?.bindings)
      ? raw.bindings.filter(
          (item): item is ExternalApiBinding =>
            Boolean(item) &&
            typeof item.fingerprint === "string" &&
            Number.isInteger(item.userId) &&
            item.userId === userId &&
            typeof item.createdAt === "string" &&
            typeof item.lastUsedAt === "string",
        )
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("外部 API 密钥绑定记录读取失败");
  }
}

async function writeBindings(
  userId: number,
  bindings: ExternalApiBinding[],
): Promise<void> {
  await mkdir(bindingRoot(), { recursive: true });
  const target = bindingPath(userId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ bindings }, null, 2), "utf8");
  await rename(temporary, target);
}

function withBindingLock<T>(userId: number, task: () => Promise<T>): Promise<T> {
  const previous = bindingLocks.get(userId) ?? Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => undefined);
  bindingLocks.set(userId, tail);
  void tail.then(() => {
    if (bindingLocks.get(userId) === tail) bindingLocks.delete(userId);
  });
  return current;
}

export async function bindExternalApiKey(
  userId: number,
  authorization: string,
): Promise<void> {
  const fingerprint = externalApiKeyFingerprint(authorization);
  await withBindingLock(userId, async () => {
    const bindings = await readBindings(userId);
    const now = new Date().toISOString();
    const existing = bindings.find((item) => item.fingerprint === fingerprint);
    if (existing) {
      existing.lastUsedAt = now;
      await writeBindings(userId, bindings);
      return;
    }
    bindings.push({
      fingerprint,
      userId,
      createdAt: now,
      lastUsedAt: now,
    });
    await writeBindings(userId, bindings.slice(-50));
  });
}

export async function isExternalApiKeyBound(
  userId: number,
  authorization: string,
): Promise<boolean> {
  const fingerprint = externalApiKeyFingerprint(authorization);
  const bindings = await readBindings(userId);
  return bindings.some((item) => item.fingerprint === fingerprint);
}

export async function resolveBoundExternalApiUser(
  authorization: string,
): Promise<number | null> {
  const fingerprint = externalApiKeyFingerprint(authorization);
  let files: string[];
  try {
    files = await (await import("node:fs/promises")).readdir(bindingRoot());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("外部 API 密钥绑定记录读取失败");
  }
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue;
    const userId = Number(file.slice(0, -5));
    if (!Number.isSafeInteger(userId) || userId <= 0) continue;
    const bindings = await readBindings(userId);
    const match = bindings.find((item) => item.fingerprint === fingerprint);
    if (match) {
      await withBindingLock(userId, async () => {
        const latest = await readBindings(userId);
        const item = latest.find((entry) => entry.fingerprint === fingerprint);
        if (item) item.lastUsedAt = new Date().toISOString();
        await writeBindings(userId, latest);
      });
      return userId;
    }
  }
  return null;
}

export async function verifyExternalApiKey(authorization: string): Promise<void> {
  const response = await fetch(`${newApiBaseUrl()}/v1/models`, {
    headers: { Authorization: authorization },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error("NewAPI 密钥无效或已失效，无法绑定到 LFN");
}
