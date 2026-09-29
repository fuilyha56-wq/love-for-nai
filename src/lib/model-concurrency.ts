export const MODEL_CONCURRENCY_LIMIT = 2 as const;

type ModelConcurrencyState = {
  active: number;
  queue: Array<() => void>;
};

const globalStore = globalThis as typeof globalThis & {
  __lfnModelConcurrencyState?: ModelConcurrencyState;
};

function state(): ModelConcurrencyState {
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

async function acquireModelConcurrencySlot(signal?: AbortSignal | null): Promise<() => void> {
  if (signal?.aborted) throw new ModelConcurrencyQueueAbortError(abortReason(signal));
  const current = state();
  if (current.active < MODEL_CONCURRENCY_LIMIT) {
    current.active += 1;
  } else {
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
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = current.queue.shift();
    if (next) next();
    else current.active -= 1;
  };
}

export async function withModelConcurrencySlot<T>(task: () => Promise<T>): Promise<T> {
  const release = await acquireModelConcurrencySlot();
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
  const releaseSlot = await acquireModelConcurrencySlot(init?.signal);
  const signal = init?.signal;
  const onAbort = () => release();
  const release = () => {
    signal?.removeEventListener("abort", onAbort);
    releaseSlot();
  };
  try {
    const response = responseWithRelease(await fetch(input, init), release);
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
