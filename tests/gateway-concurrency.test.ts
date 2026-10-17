import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime-config", () => ({
  runtimeAffGateway: async () => ({ baseUrl: "http://gateway.test:41555", token: "test-token" }),
  runtimeNaiImageUpstream: async () => ({ baseUrl: "https://native.test:41556", token: "test-token" }),
  runtimeNewApiBaseUrl: async () => "http://newapi.test:3000",
}));

import { fetchWithModelConcurrency } from "@/lib/model-concurrency";

const store = globalThis as typeof globalThis & {
  __lfnGatewayCapacityCache?: { expiresAt: number };
  __lfnGatewayConfigCache?: unknown;
  __lfnModelConcurrencySources?: Map<string, unknown>;
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete store.__lfnGatewayCapacityCache;
  delete store.__lfnGatewayConfigCache;
  store.__lfnModelConcurrencySources?.clear();
});

describe("Gateway 账号容量", () => {
  it("NewAPI 与原生入口共享六个上游账号的并发槽", async () => {
    let generated = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/admin/api/concurrency")) return Response.json({ concurrency: 6 });
      generated++;
      return new Response("ok");
    }));
    const init = { method: "POST", body: JSON.stringify({ model: "nai-v5-full" }) };
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      fetchWithModelConcurrency(index % 2 ? "https://native.test:41556/ai/generate-image"
        : "http://newapi.test:3000/v1/images/generations", init),
    ));
    const next = fetchWithModelConcurrency("http://gateway.test:41555/v1/images/generations", init);
    try {
      await vi.waitFor(() => expect(generated).toBe(6));
      await responses[0].text();
      responses.push(await next);
      expect(generated).toBe(7);
    } finally {
      await Promise.all(responses.map(r => r.body?.cancel().catch(() => undefined)));
    }
  });

  it("容量接口短暂失败时保留已知账号数", async () => {
    let capacityRequests = 0;
    let generated = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/admin/api/concurrency")) {
        capacityRequests++;
        if (capacityRequests > 1) throw new Error("control endpoint disconnected");
        return Response.json({ concurrency: 3 });
      }
      generated++;
      return new Response("ok");
    }));
    await (await fetchWithModelConcurrency("http://gateway.test:41555/v1/images/generations")).text();
    store.__lfnGatewayCapacityCache!.expiresAt = 0;
    const responses = await Promise.all(Array.from({ length: 3 }, () =>
      fetchWithModelConcurrency("http://gateway.test:41555/v1/images/generations"),
    ));
    try {
      expect(generated).toBe(4);
      expect(capacityRequests).toBe(2);
    } finally {
      await Promise.all(responses.map(r => r.body?.cancel().catch(() => undefined)));
    }
  });

  it("其他模型来源不被生图请求占满槽位", async () => {
    vi.stubGlobal("fetch", vi.fn(async url => String(url).endsWith("/admin/api/concurrency")
      ? Response.json({ concurrency: 3 }) : new Response("ok")));
    const responses = await Promise.all(Array.from({ length: 3 }, () =>
      fetchWithModelConcurrency("http://gateway.test:41555/v1/images/generations"),
    ));
    try {
      const unrelated = await fetchWithModelConcurrency("https://chat.test/v1/chat/completions");
      responses.push(unrelated);
      expect(await unrelated.text()).toBe("ok");
    } finally {
      await Promise.all(responses.map(r => r.body?.cancel().catch(() => undefined)));
    }
  });
});
