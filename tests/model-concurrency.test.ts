import { describe, expect, it, vi } from "vitest";
import {
  fetchWithModelConcurrency,
  MODEL_CONCURRENCY_LIMIT,
  ModelConcurrencyQueueAbortError,
  withModelConcurrencySlot,
} from "@/lib/model-concurrency";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("模型调用并发门", () => {
  it("全局最多允许两个任务同时执行并保持 FIFO", async () => {
    const releases = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    const tasks = releases.map((release, index) =>
      withModelConcurrencySlot(async () => {
        started.push(index);
        active += 1;
        peak = Math.max(peak, active);
        await release.promise;
        active -= 1;
        return index;
      }),
    );

    try {
      await vi.waitFor(() => expect(started).toEqual([0, 1]));
      releases[0].resolve();
      await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
      releases[1].resolve();
      await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
    } finally {
      releases.forEach((release) => release.resolve());
    }

    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3]);
    expect(peak).toBe(MODEL_CONCURRENCY_LIMIT);
  });

  it("任务失败后仍释放并发槽", async () => {
    await expect(
      withModelConcurrencySlot(async () => {
        throw new Error("upstream failed");
      }),
    ).rejects.toThrow("upstream failed");
    await expect(withModelConcurrencySlot(async () => "recovered")).resolves.toBe("recovered");
  });

  it("流式响应读取完成前持续占用槽位", async () => {
    const originalFetch = globalThis.fetch;
    const streamReleases = [deferred(), deferred()];
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      const current = call;
      call += 1;
      return new Response(new ReadableStream({
        async pull(controller) {
          await streamReleases[current]?.promise;
          controller.enqueue(new TextEncoder().encode(String(current)));
          controller.close();
        },
      }));
    });
    try {
      const first = await fetchWithModelConcurrency("https://example.test/1");
      const second = await fetchWithModelConcurrency("https://example.test/2");
      let thirdStarted = false;
      const third = fetchWithModelConcurrency("https://example.test/3").then((response) => {
        thirdStarted = true;
        return response;
      });
      await Promise.resolve();
      expect(thirdStarted).toBe(false);
      streamReleases[0].resolve();
      await expect(first.text()).resolves.toBe("0");
      await vi.waitFor(() => expect(thirdStarted).toBe(true));
      streamReleases[1].resolve();
      await second.text();
      await (await third).text();
    } finally {
      streamReleases.forEach((release) => release.resolve());
      globalThis.fetch = originalFetch;
    }
  });

  it("已取消的请求不会占用槽位，也不会调用 fetch", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock;
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(
        fetchWithModelConcurrency("https://example.test/canceled", {
          signal: controller.signal,
        }),
      ).rejects.toBeInstanceOf(ModelConcurrencyQueueAbortError);
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(
        (await fetchWithModelConcurrency("https://example.test/next")).text(),
      ).resolves.toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("排队请求取消后从队列移除，后续请求仍可获得槽位", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock;
    const responses: Response[] = [];
    try {
      responses.push(await fetchWithModelConcurrency("https://example.test/first"));
      responses.push(await fetchWithModelConcurrency("https://example.test/second"));
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const controller = new AbortController();
      const canceled = fetchWithModelConcurrency("https://example.test/canceled", {
        signal: controller.signal,
      });
      const next = fetchWithModelConcurrency("https://example.test/next");
      controller.abort();
      await expect(canceled).rejects.toBeInstanceOf(ModelConcurrencyQueueAbortError);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await responses[0].text();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      responses.push(await next);
      await responses[1].text();
      await responses[2].text();

      const after = await fetchWithModelConcurrency("https://example.test/after");
      responses.push(after);
      await expect(after.text()).resolves.toBe("ok");
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      await Promise.all(responses.map((response) => response.body?.cancel().catch(() => undefined)));
      globalThis.fetch = originalFetch;
    }
  });

  it("响应体未读取时，超时信号仍释放并发槽", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock;
    const responses: Response[] = [];
    try {
      const first = new AbortController();
      responses.push(await fetchWithModelConcurrency("https://example.test/first", { signal: first.signal }));
      responses.push(await fetchWithModelConcurrency("https://example.test/second"));
      const next = fetchWithModelConcurrency("https://example.test/next");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      first.abort();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      responses.push(await next);
      expect(await responses[2].text()).toBe("ok");
    } finally {
      await Promise.all(responses.map((response) => response.body?.cancel().catch(() => undefined)));
      globalThis.fetch = originalFetch;
    }
  });
});
