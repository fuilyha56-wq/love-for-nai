import { createHash } from "node:crypto";
import { upstreamClientHeaders } from "@/lib/upstream-request";
import { retryAfterSeconds } from "@/lib/retry-after";

type SavedResponse = { body: string; status: number; headers: Array<[string, string]> };
type Entry = { expiresAt: number; response?: SavedResponse; pending?: Promise<SavedResponse> };
const runtime = globalThis as typeof globalThis & { lfnUpstreamReads?: Map<string, Entry> };
const reads = (runtime.lfnUpstreamReads ??= new Map());
const LIMIT = 256;

export function invalidateUpstreamReads(baseUrl: string): void {
  const prefix = `${baseUrl.replace(/\/+$/, "")}/`;
  for (const key of reads.keys()) if (key.startsWith(prefix)) reads.delete(key);
}

/** Coalesce identical credentials only; TTL is explicitly chosen by each read-only caller. */
export async function cachedUpstreamRead(url: string, headers: HeadersInit, ttlMs = 0): Promise<Response> {
  const outgoing = new Headers(headers);
  for (const [key, value] of Object.entries(await upstreamClientHeaders())) outgoing.set(key, value);
  const scope = createHash("sha256").update(JSON.stringify([...outgoing.entries()].sort())).digest("hex");
  const key = `${url}|${scope}`;
  const now = Date.now();
  let entry = reads.get(key);
  if (!entry || (!entry.pending && entry.expiresAt <= now)) {
    for (const [candidate, value] of reads) if (!value.pending && value.expiresAt <= now) reads.delete(candidate);
    if (reads.size >= LIMIT) {
      const oldest = [...reads].find(([, value]) => !value.pending);
      if (oldest) reads.delete(oldest[0]);
      else return fetch(url, { headers: Object.fromEntries(outgoing), cache: "no-store", signal: AbortSignal.timeout(10_000) });
    }
    entry = { expiresAt: now };
    const current = entry;
    const pending = (async () => {
      const response = await fetch(url, { headers: Object.fromEntries(outgoing), cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const body = await response.text();
      if (response.status === 401 || response.status === 403) {
        const origin = new URL(url).origin + "/";
        for (const candidate of reads.keys()) {
          if (candidate.startsWith(origin) && candidate.endsWith(`|${scope}`)) reads.delete(candidate);
        }
      }
      const saved = { body, status: response.status, headers: [...response.headers.entries()] };
      let success = false;
      if (response.ok && body.length <= 2_000_000) {
        try { const payload = JSON.parse(body); success = payload !== null && typeof payload === "object" && payload.success !== false; } catch { /* Malformed data must not be retained as a successful cache entry. */ }
      }
      current.expiresAt = Date.now() + (response.status === 429 ? retryAfterSeconds(response.headers.get("retry-after")) * 1000 : success ? ttlMs : 0);
      current.response = saved;
      return saved;
    })();
    current.pending = pending;
    reads.set(key, current);
    void pending.then(() => { current.pending = undefined; if (current.expiresAt <= Date.now() && reads.get(key) === current) reads.delete(key); }, () => { if (reads.get(key) === current) reads.delete(key); });
  }
  const saved = entry.pending ? await entry.pending : entry.response!;
  const responseHeaders = new Headers(saved.headers);
  if (saved.status === 429) responseHeaders.set("Retry-After", String(Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000))));
  return new Response(saved.body, { status: saved.status, headers: responseHeaders });
}
