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

async function acquireModelConcurrencySlot(): Promise<() => void> {
  const current = state();
  if (current.active < MODEL_CONCURRENCY_LIMIT) {
    current.active += 1;
  } else {
    await new Promise<void>((resolve) => current.queue.push(resolve));
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
  const release = await acquireModelConcurrencySlot();
  try {
    return responseWithRelease(await fetch(input, init), release);
  } catch (error) {
    release();
    throw error;
  }
}