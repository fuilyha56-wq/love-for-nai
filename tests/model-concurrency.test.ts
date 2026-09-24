import { describe, expect, it, vi } from "vitest";
import {
  fetchWithModelConcurrency,
  MODEL_CONCURRENCY_LIMIT,
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
});