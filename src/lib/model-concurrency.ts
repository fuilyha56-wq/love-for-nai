import { runtimeAffGateway, runtimeNaiImageUpstream, runtimeNewApiBaseUrl } from "@/lib/runtime-config";

// Non-Gateway sources retain the local fallback; Gateway requests use live pool capacity.
export const MODEL_CONCURRENCY_LIMIT = 2 as const;
const GATEWAY_CONFIG_TTL_MS = 5_000;
const GATEWAY_CAPACITY_TTL_MS = 3_000;
const GATEWAY_CAPACITY_TIMEOUT_MS = 1_500;

type GatewayConfig = { baseUrl: string; token: string; nativeUrl?: string; newApiUrl?: string } | null;
type GatewayConfigCache = { expiresAt: number; value?: GatewayConfig; pending?: Promise<GatewayConfig> };
type GatewayCapacityCache = { key: string; expiresAt: number; value: number; pending?: Promise<number> };

type ModelConcurrencyState = {
  active: number;
  queue: Array<() => void>;
};

const globalStore = globalThis as typeof globalThis & {
  __lfnModelConcurrencyState?: ModelConcurrencyState;
  __lfnModelConcurrencySources?: Map<string, ModelConcurrencyState>;
  __lfnGatewayConfigCache?: GatewayConfigCache;
  __lfnGatewayCapacityCache?: GatewayCapacityCache;
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
    return cached.value ?? null;
  }
  const entry: GatewayConfigCache = { expiresAt: now + GATEWAY_CONFIG_TTL_MS };
  const pending = runtimeAffGateway()
    .then(async (config) => {
      if (config?.baseUrl && config.token) {
        const [native, newApiUrl] = await Promise.all([
          runtimeNaiImageUpstream(), runtimeNewApiBaseUrl(),
        ]);
        entry.value = { ...config, nativeUrl: native?.baseUrl, newApiUrl };
      } else {
        entry.value = null;
      }
      entry.expiresAt = Date.now() + GATEWAY_CONFIG_TTL_MS;
      return entry.value;
    })
    .catch(() => {
      entry.value = null;
      entry.expiresAt = Date.now() + GATEWAY_CONFIG_TTL_MS;
      return null;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  entry.pending = pending;
  globalStore.__lfnGatewayConfigCache = entry;
  return pending;
}

function targetsGateway(input: RequestInfo | URL, baseUrl: string): boolean {
  try {
    const requestUrl = typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
    const target = new URL(requestUrl);
    const base = new URL(baseUrl.replace(/\/v1\/?$/i, ""));
    const prefix = base.pathname.replace(/\/+$/, "");
    return target.origin === base.origin &&
      (!prefix || target.pathname === prefix || target.pathname.startsWith(`${prefix}/`));
  } catch {
    return false;
  }
}

async function gatewayCapacity(config: Exclude<GatewayConfig, null>): Promise<number> {
  const gatewayRoot = config.baseUrl.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
  const key = `${gatewayRoot}|${config.token}`;
  const now = Date.now();
  const cached = globalStore.__lfnGatewayCapacityCache;
  if (cached?.key === key && cached.expiresAt > now) {
    if (cached.pending) return cached.pending;
    return cached.value;
  }

  const previous = cached?.key === key ? cached.value : MODEL_CONCURRENCY_LIMIT;
  const entry: GatewayCapacityCache = { key, expiresAt: now + 1_000, value: previous };
  const pending = fetch(`${gatewayRoot}/admin/api/concurrency`, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(GATEWAY_CAPACITY_TIMEOUT_MS),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Gateway capacity returned ${response.status}`);
      const body = await response.json() as { concurrency?: unknown };
      const count = Number(body.concurrency);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error("Gateway capacity is invalid");
      entry.value = count;
      entry.expiresAt = Date.now() + GATEWAY_CAPACITY_TTL_MS;
      return count;
    })
    .catch(() => {
      // Keep the last known pool size through a transient control-plane error.
      // Gateway still enforces each physical account's generation slot.
      entry.value = previous;
      entry.expiresAt = Date.now() + 1_000;
      return previous;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  entry.pending = pending;
  globalStore.__lfnGatewayCapacityCache = entry;
  return pending;
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
}

function isRoutedNaiImage(input: RequestInfo | URL, init: RequestInit | undefined, config: Exclude<GatewayConfig, null>): boolean {
  const pathname = new URL(requestUrl(input)).pathname;
  if (config.nativeUrl && targetsGateway(input, config.nativeUrl) && pathname.includes("/ai/")) return true;
  if (!config.newApiUrl || !targetsGateway(input, config.newApiUrl) || !pathname.includes("/images/")) return false;
  try {
    const model = typeof init?.body === "string" ? JSON.parse(init.body).model
      : init?.body instanceof FormData ? init.body.get("model") : null;
    return typeof model === "string" && model.startsWith("nai-");
  } catch {
    return false;
  }
}

async function requestConcurrencyLimit(input: RequestInfo | URL, init?: RequestInit): Promise<{ limit: number; source: string }> {
  const config = await gatewayConfig();
  if (config && (targetsGateway(input, config.baseUrl) || isRoutedNaiImage(input, init, config))) {
    return { limit: await gatewayCapacity(config), source: `gateway:${config.baseUrl}` };
  }
  return { limit: MODEL_CONCURRENCY_LIMIT, source: new URL(requestUrl(input)).origin };
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
    if (signal?.aborted) throw new ModelConcurrencyQueueAbortError(abortReason(signal));
    if (refreshLimit) currentLimit = Math.max(1, await refreshLimit());
    if (signal?.aborted) throw new ModelConcurrencyQueueAbortError(abortReason(signal));
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
  if (init?.signal?.aborted)
    throw new ModelConcurrencyQueueAbortError(abortReason(init.signal));
  const { limit, source } = await requestConcurrencyLimit(input, init);
  const releaseSlot = await acquireModelConcurrencySlot(
    limit,
    init?.signal,
    async () => (await requestConcurrencyLimit(input, init)).limit,
    source,
  );
  const signal = init?.signal;
  const onAbort = () => release();
  const release = () => {
    signal?.removeEventListener("abort", onAbort);
    releaseSlot();
  };
  try {
    const outgoingHeaders = new Headers(init?.headers);
    const operationId = outgoingHeaders.get("x-lfn-internal-operation");
    if (operationId) {
      outgoingHeaders.delete("x-lfn-internal-operation");
      try { await import("./light-risk").then(m => m.recheckQueuedRisk(operationId)); }
      catch (error) { throw new ModelConcurrencyQueueAbortError(error); }
    }
    const response = responseWithRelease(await fetch(input, operationId ? { ...init, headers: outgoingHeaders } : init), release);
    // A caller may leave a response body unread. Its request timeout must still
    // free the slot, even when there is no reader to observe the abort.
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return response;
  } catch (error) {
    release();
    throw error;
  }
}
