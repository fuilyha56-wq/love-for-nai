import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { decodeSession, encodeSession, type LfnSession } from "@/lib/session";
import { runtimeNewApiBaseUrl } from "@/lib/runtime-config";
import { newApiIdentity } from "@/lib/newapi-user";
import { upstreamClientHeaders } from "@/lib/upstream-request";

const state = globalThis as typeof globalThis & {
  lfnRefreshLocks?: Map<string, Promise<LfnSession | null>>;
  lfnRefreshCooldowns?: Map<string, LfnSession>;
  lfnUnpersistedRefreshes?: Map<string, LfnSession>;
};
const locks = (state.lfnRefreshLocks ??= new Map());
const cooldowns = (state.lfnRefreshCooldowns ??= new Map());
const unpersisted = (state.lfnUnpersistedRefreshes ??= new Map());

function deferRefresh(file: string, session: LfnSession, retryAfter?: string | null): LfnSession {
  const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter)
    : retryAfter ? (Date.parse(retryAfter) - Date.now()) / 1000 : 60;
  const delay = Number.isFinite(seconds) ? Math.max(30, Math.min(900, seconds)) : 60;
  const deferred = { ...session, upstreamRetryAt: Date.now() + delay * 1000 };
  for (const [key, entry] of cooldowns) if ((entry.upstreamRetryAt ?? 0) <= Date.now()) cooldowns.delete(key);
  if (cooldowns.size >= 2000) cooldowns.delete(cooldowns.keys().next().value!);
  cooldowns.set(file, deferred);
  return deferred;
}

export function loginCookie(response: Response): string {
  const cookies = response.headers.getSetCookie();
  const refresh = cookies.find(value => value.startsWith("new_api_refresh="));
  return (refresh || cookies[0] || "").split(";")[0];
}

function recordPath(session: LfnSession): string {
  const key = session.upstreamSessionKey || createHash("sha256").update(session.upstreamCookie).digest("hex");
  return path.join(process.env.LFN_DATA_DIR || path.join(process.cwd(), "data"), "auth-refresh", `${key}.session`);
}

function expiry(session: LfnSession): number | null {
  if (session.accessExpiresAt) return session.accessExpiresAt;
  try {
    const payload = JSON.parse(Buffer.from(session.accessToken!.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch { return null; }
}

export async function refreshedUpstreamSession(original: LfnSession): Promise<LfnSession | null> {
  if (original.systemToken || !original.accessToken || !original.upstreamCookie.startsWith("new_api_refresh=")) return original;
  const file = recordPath(original);
  const deferred = cooldowns.get(file);
  if (deferred && (deferred.upstreamRetryAt ?? 0) > Date.now() && deferred.epoch === original.epoch && deferred.userEpoch === original.userEpoch) return deferred;
  cooldowns.delete(file);
  const existing = locks.get(file);
  if (existing) return existing;
  const pending = (async () => {
    let session: LfnSession = { ...original, upstreamSessionKey: original.upstreamSessionKey || createHash("sha256").update(original.upstreamCookie).digest("hex") };
    try {
      const saved = decodeSession(await readFile(file, "utf8"));
      if (saved?.userId === original.userId && saved.epoch === original.epoch && saved.userEpoch === original.userEpoch) session = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return deferRefresh(file, session);
    }
    const recovered = unpersisted.get(file);
    if (recovered && recovered.expiresAt > Date.now() && recovered.epoch === original.epoch && recovered.userEpoch === original.userEpoch) {
      session = recovered;
      try {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(`${file}.tmp`, await encodeSession(session), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        unpersisted.delete(file);
      } catch { return deferRefresh(file, session); }
    }
    const expiresAt = expiry(session);
    if (expiresAt === null || expiresAt > Date.now() + 60_000) return session;
    let response: Response;
    try {
      response = await fetch(`${(await runtimeNewApiBaseUrl()).replace(/\/+$/, "")}/api/user/auth/refresh`, {
        method: "POST", headers: { Cookie: session.upstreamCookie, "Content-Type": "application/json", ...await upstreamClientHeaders() },
        body: "{}", cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return deferRefresh(file, session);
    }
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return deferRefresh(file, session, response.headers.get("retry-after"));
    }
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== "object") return deferRefresh(file, session);
    const user = newApiIdentity(result.data);
    if (result.success !== true || !user || user.id !== original.userId || typeof result.data?.access_token !== "string") return null;
    const next: LfnSession = { ...session, upstreamRetryAt: undefined, accessToken: result.data.access_token, upstreamCookie: loginCookie(response) || session.upstreamCookie,
      accessExpiresAt: typeof result.data.access_expires_at === "number" ? result.data.access_expires_at * 1000 : undefined };
    try {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.tmp`;
      await writeFile(temporary, await encodeSession(next), { mode: 0o600 });
      await rename(temporary, file);
    } catch {
      // Keep the freshly verified rotated credential during a transient volume failure.
      for (const [key, entry] of unpersisted) if (entry.expiresAt <= Date.now()) unpersisted.delete(key);
      if (unpersisted.size >= 2000) unpersisted.delete(unpersisted.keys().next().value!);
      unpersisted.set(file, next);
      return deferRefresh(file, next);
    }
    return next;
  })();
  locks.set(file, pending);
  try { return await pending; } finally { if (locks.get(file) === pending) locks.delete(file); }
}

export async function forgetUpstreamSession(session: LfnSession): Promise<void> {
  if (session.upstreamCookie.startsWith("new_api_refresh=")) {
    cooldowns.delete(recordPath(session));
    unpersisted.delete(recordPath(session));
    await rm(recordPath(session), { force: true });
  }
}
