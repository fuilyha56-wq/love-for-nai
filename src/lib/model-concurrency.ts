import { runtimeAffGateway, runtimeNaiImageUpstream, runtimeNewApiBaseUrl } from "@/lib/runtime-config";

// Older Gateway versions and other providers still need local concurrency protection.
export const MODEL_CONCURRENCY_LIMIT = 2 as const;
const GATEWAY_CONFIG_TTL_MS = 5_000;
const GATEWAY_CAPACITY_TTL_MS = 3_000;
const GATEWAY_CAPACITY_TIMEOUT_MS = 1_500;

type GatewayEndpoint = { baseUrl: string; token: string };
type GatewayConfig = { gateway: GatewayEndpoint | null; native: GatewayEndpoint | null; newApiUrl: string | null };
type GatewayConfigCache = { expiresAt: number; value?: GatewayConfig; pending?: Promise<GatewayConfig> };
type GatewayAdmission = { limit: number; capabilityQueue: boolean };
type GatewayAdmissionCache = { key: string; expiresAt: number; value: GatewayAdmission; pending?: Promise<GatewayAdmission> };

const gatewayQueuedImagePaths = new Set([
  "/ai/generate-image", "/ai/generate-image-stream", "/ai/upscale", "/ai/augment-image", "/ai/annotate-image", "/ai/encode-vibe",
  "/v1/images/generations", "/v1/images/generations/stream", "/v1/images/generations/native",
  "/v1/images/edits", "/v1/images/inpainting", "/v1/images/img2img", "/v1/images/encode-vibe",
  "/v1/images/vibe-transfer", "/v1/images/character-reference", "/v1/images/precise-reference",
  "/v1/images/upscale", "/v1/images/annotate",
  "/v1/images/director/declutter", "/v1/images/director/bg-remover", "/v1/images/director/lineart",
  "/v1/images/director/sketch", "/v1/images/director/colorize", "/v1/images/director/emotion",
]);

type ModelConcurrencyState = {
  active: number;
  queue: Array<() => void>;
};

const globalStore = globalThis as typeof globalThis & {
  __lfnModelConcurrencyState?: ModelConcurrencyState;
  __lfnModelConcurrencySources?: Map<string, ModelConcurrencyState>;
  __lfnGatewayConfigCache?: GatewayConfigCache;
  __lfnGatewayAdmissionCache?: Partial<Record<"gateway" | "native", GatewayAdmissionCache>>;
};

function state(source?: string): ModelConcurrencyState {
  if (source) {
    globalStore.__lfnModelConcurrencySources ??= new Map();
    let current = globalStore.__lfnModelConcurrencySources.get(source);
    if (!current) {
      current = { active: 0, queue: [] };
      globalStore.__lfnModelConcurrencySources.set(source, current);
    }
    return current;
  }
  globalStore.__lfnModelConcurrencyState ??= { active: 0, queue: [] };
  return globalStore.__lfnModelConcurrencyState;
}

export class ModelConcurrencyQueueAbortError extends Error {
  constructor(public readonly reason: unknown) {
    super("模型请求在排队期间已取消");
    this.name = "ModelConcurrencyQueueAbortError";
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

async function gatewayConfig(): Promise<GatewayConfig> {
  const now = Date.now();
  const cached = globalStore.__lfnGatewayConfigCache;
  if (cached && cached.expiresAt > now) {
    if (cached.pending) return cached.pending;
    if (cached.value) return cached.value;
  }
  const entry: GatewayConfigCache = { expiresAt: now + GATEWAY_CONFIG_TTL_MS };
  const pending = Promise.allSettled([
    Promise.resolve().then(() => runtimeAffGateway()),
    Promise.resolve().then(() => runtimeNaiImageUpstream()),
    Promise.resolve().then(() => runtimeNewApiBaseUrl()),
  ])
    .then(([gateway, native, newApiUrl]) => {
      entry.value = {
        gateway: gateway.status === "fulfilled" ? gateway.value : null,
        native: native.status === "fulfilled" ? native.value : null,
        newApiUrl: newApiUrl.status === "fulfilled" ? newApiUrl.value : null,
      };
      entry.expiresAt = Date.now() + GATEWAY_CONFIG_TTL_MS;
      return entry.value;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  entry.pending = pending;
  globalStore.__lfnGatewayConfigCache = entry;
  return pending;
}

function gatewayRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function relativePath(target: URL, baseUrl: string): string | undefined {
  try {
    const base = new URL(gatewayRoot(baseUrl));
    const prefix = base.pathname.replace(/\/+$/, "");
    if (target.origin === base.origin &&
      (!prefix || target.pathname === prefix || target.pathname.startsWith(`${prefix}/`))) {
      return target.pathname.slice(prefix.length) || "/";
    }
  } catch {
    // Invalid upstream settings must not disable the local limiter.
  }
}

async function gatewayAdmission(endpoint: GatewayEndpoint, kind: "gateway" | "native"): Promise<GatewayAdmission> {
  const root = gatewayRoot(endpoint.baseUrl);
  const key = `${root}|${endpoint.token}`;
  const now = Date.now();
  const cache = globalStore.__lfnGatewayAdmissionCache ??= {};
  const cached = cache[kind];
  if (cached?.key === key && cached.expiresAt > now) {
    if (cached.pending) return cached.pending;
    return cached.value;
  }

  const fallback = { limit: cached?.key === key ? cached.value.limit : MODEL_CONCURRENCY_LIMIT, capabilityQueue: false };
  const entry: GatewayAdmissionCache = { key, expiresAt: now + GATEWAY_CAPACITY_TIMEOUT_MS, value: fallback };
  const pending = fetch(`${root}/admin/api/concurrency`, {
    headers: { Authorization: `Bearer ${endpoint.token}`, Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(GATEWAY_CAPACITY_TIMEOUT_MS),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Gateway capacity returned ${response.status}`);
      const body = await response.json() as { concurrency?: unknown; queue_policy?: unknown };
      const { concurrency } = body;
      const capabilityQueue = body.queue_policy === "capability-v1";
      if (typeof concurrency !== "number" || !Number.isSafeInteger(concurrency) || concurrency < (capabilityQueue ? 0 : 1)) {
        throw new Error("Gateway capacity is invalid");
      }
      entry.value = { limit: Math.max(1, concurrency), capabilityQueue };
      entry.expiresAt = Date.now() + GATEWAY_CAPACITY_TTL_MS;
      return entry.value;
    })
    .catch(() => {
      // Preserve the last known capacity, but require a fresh confirmation before delegating admission.
      entry.expiresAt = Date.now() + 1_000;
      return fallback;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  entry.pending = pending;
  cache[kind] = entry;
  return pending;
}

function requestField(body: BodyInit | null | undefined, name: string): unknown {
  if (body instanceof FormData) return body.get(name);
  if (typeof body !== "string" || !body.includes(`"${name}"`)) return undefined;
  try { return JSON.parse(body)?.[name]; }
  catch { return undefined; }
}

function isGatewayQueuedImageRequest(path: string | undefined, input: RequestInfo | URL, init?: RequestInit): boolean {
  if (!path || !gatewayQueuedImagePaths.has(path)) return false;
  const request = input instanceof Request ? input : undefined;
  if ((init?.method ?? request?.method)?.toUpperCase() !== "POST") return false;
  if (path === "/v1/images/generations") {
    if ((init?.body == null && request?.body) ||
        (init?.body != null && typeof init.body !== "string" && !(init.body instanceof FormData))) return false;
    const header = new Headers(init?.headers ?? request?.headers).get("x-novelai-operation");
    const operation = requestField(init?.body, "novelai_operation");
    return ![header, operation].some(value => typeof value === "string" && value.trim().toLowerCase() === "suggest-tags");
  }
  return true;
}

async function requestConcurrencyLimit(input: RequestInfo | URL, init?: RequestInit): Promise<{ limit: number; source: string } | null> {
  const target = new URL(input instanceof Request ? input.url : String(input));
  const config = await gatewayConfig();
  const { gateway, native, newApiUrl } = config;
  if (gateway && isGatewayQueuedImageRequest(relativePath(target, gateway.baseUrl), input, init)) {
    const admission = await gatewayAdmission(gateway, "gateway");
    return admission.capabilityQueue ? null : { limit: admission.limit, source: `gateway:${gatewayRoot(gateway.baseUrl)}` };
  }

  const nativeImage = native && isGatewayQueuedImageRequest(relativePath(target, native.baseUrl), input, init);
  if (native && nativeImage) {
    const admission = await gatewayAdmission(native, "native");
    if (admission.capabilityQueue) return null;
    if (!gateway) return { limit: admission.limit, source: target.origin };
  }

  // A model name cannot establish which channel a separate NewAPI server selected.
  // Preserve the existing local guard on these requests and on unconfirmed native aliases.
  const newApiPath = newApiUrl && relativePath(target, newApiUrl);
  const model = newApiPath && isGatewayQueuedImageRequest(newApiPath, input, init) ? requestField(init?.body, "model") : undefined;
  if (gateway && (nativeImage || typeof model === "string" && model.startsWith("nai-"))) {
    const admission = await gatewayAdmission(gateway, "gateway");
    return { limit: admission.limit, source: `gateway:${gatewayRoot(gateway.baseUrl)}` };
  }
  return { limit: MODEL_CONCURRENCY_LIMIT, source: target.origin };
}

async function acquireModelConcurrencySlot(
  limit: number,
  signal?: AbortSignal | null,
  refreshLimit?: () => Promise<number>,
  source?: string,
): Promise<() => void> {
  if (signal?.aborted) throw new ModelConcurrencyQueueAbortError(abortReason(signal));
  const current = state(source);
  let currentLimit = Math.max(1, limit);
  while (current.active >= currentLimit) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const index = current.queue.indexOf(wake);
        if (index < 0) return; // The slot has already been handed to this waiter.
        current.queue.splice(index, 1);
        signal?.removeEventListener("abort", onAbort);
        reject(new ModelConcurrencyQueueAbortError(abortReason(signal!)));
      };
      current.queue.push(wake);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    try {
      if (signal?.aborted) throw new ModelConcurrencyQueueAbortError(abortReason(signal));
      if (refreshLimit) currentLimit = Math.max(1, await refreshLimit());
      if (signal?.aborted) throw new ModelConcurrencyQueueAbortError(abortReason(signal));
    } catch (error) {
      if (current.active < currentLimit) current.queue.shift()?.();
      throw error;
    }
  }
  current.active += 1;
  if (current.active < currentLimit) current.queue.shift()?.();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current.active -= 1;
    current.queue.shift()?.();
  };
}

export async function withModelConcurrencySlot<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const release = await acquireModelConcurrencySlot(MODEL_CONCURRENCY_LIMIT, signal);
  try {
    return await task();
  } finally {
    release();
  }
}

function responseWithRelease(response: Response, release: () => void): Response {
  if (!response.body) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          release();
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function fetchWithModelConcurrency(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = input instanceof Request ? input : undefined;
  const signal = init?.signal ?? request?.signal;
  if (signal?.aborted) throw new ModelConcurrencyQueueAbortError(abortReason(signal));
  const limit = await requestConcurrencyLimit(input, init);
  const releaseSlot = limit && await acquireModelConcurrencySlot(
    limit.limit,
    signal,
    async () => (await requestConcurrencyLimit(input, init))?.limit ?? Infinity,
    limit.source,
  );
  const onAbort = () => release();
  const release = () => {
    signal?.removeEventListener("abort", onAbort);
    releaseSlot?.();
  };
  try {
    if (signal?.aborted) throw new ModelConcurrencyQueueAbortError(abortReason(signal));
    const outgoingHeaders = new Headers(init?.headers ?? request?.headers);
    const operationId = outgoingHeaders.get("x-lfn-internal-operation");
    if (operationId) {
      outgoingHeaders.delete("x-lfn-internal-operation");
      try { await import("./light-risk").then(m => m.recheckQueuedRisk(operationId)); }
      catch (error) { throw new ModelConcurrencyQueueAbortError(error); }
    }
    if (signal?.aborted) throw new ModelConcurrencyQueueAbortError(abortReason(signal));
    const response = await fetch(input, operationId ? { ...init, headers: outgoingHeaders } : init);
    if (!releaseSlot) return response;
    // A caller may leave a response body unread. Its request timeout must still
    // free the slot, even when there is no reader to observe the abort.
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return responseWithRelease(response, release);
  } catch (error) {
    release();
    throw error;
  }
}
