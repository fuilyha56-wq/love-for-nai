import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), history: vi.fn(), events: [] as Array<{ eventType: string; sampleIndex: number; image?: Uint8Array; message?: string }>, finish: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ userId: 78601, username: "stream-history-test" }) }));
vi.mock("@/lib/daily-image-billing", () => ({ dailyImagePolicy: async () => ({ strictApiBilling: false }) }));
vi.mock("@/lib/aff", () => ({ trySpendImageCredits: async () => null, refundImageCredits: vi.fn() }));
vi.mock("@/lib/newapi", () => ({
  getImageToken: async () => "token",
  resolvedImageUpstream: async () => ({ baseUrl: "http://gateway.test", token: "token" }),
  resolvedNaiImageUpstream: async () => ({ baseUrl: "http://gateway.test", token: "token" }),
  resolvedNewApiBaseUrl: async () => "http://gateway.test",
  imageFromResult: (result: { data?: Array<{ b64_json: string }> }) => (result.data || []).map((item) => `data:image/png;base64,${item.b64_json}`),
}));
vi.mock("@/lib/platform", () => ({ resolvedAuthProviderId: async () => "local" }));
vi.mock("@/lib/runtime-config", async (original) => ({ ...await original<typeof import("@/lib/runtime-config")>(), isNaiModelEnabled: async () => true }));
vi.mock("@/lib/model-concurrency", () => ({ fetchWithModelConcurrency: mocks.send }));
vi.mock("@/lib/history", async (original) => ({ ...await original<typeof import("@/lib/history")>(), saveHistory: mocks.history }));
vi.mock("@/lib/risk-control", () => ({ evaluateImageRisk: async () => ({ decision: "allow" }) }));
vi.mock("@/lib/gateway-log", () => ({ gatewayLogStart: () => () => undefined }));
vi.mock("@/lib/request-audit", () => ({ startRequestAudit: async () => ({ requestId: "stream-request", record: {}, finish: mocks.finish, responseHeaders: (init?: HeadersInit) => new Headers(init) }) }));
vi.mock("@/lib/nai-stream", async (original) => ({
  ...await original<typeof import("@/lib/nai-stream")>(),
  readNaiMsgpackStream: async function* () { yield* mocks.events; },
}));

import { POST } from "@/app/api/images/operate/route";
import { consumeImageStream } from "@/lib/sse";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events = [{ eventType: "final", sampleIndex: 0, image: new Uint8Array([1, 2, 3]) }];
  mocks.send.mockImplementation(async () => new Response("mock-native-stream"));
  mocks.history.mockResolvedValue([]);
});

function request(extra: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/images/operate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "generate", model: "nai-v5-full", prompt: "test", width: 832, height: 1216, n: 1, ...extra }),
  });
}

async function consume(extra: Record<string, unknown> = {}) {
  const response = await POST(request(extra));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const onComplete = vi.fn();
  const images = await consumeImageStream(response, { expected: Number(extra.n || 1), onPreview: vi.fn(), onProgress: vi.fn(), onComplete });
  return { images, historyIds: onComplete.mock.calls[0][0] as string[] };
}

describe("streamed result/account history correlation", () => {
  it("keeps quality opt-out through native streaming and its compatibility fallback", async () => {
    mocks.events = [{ eventType: "error", sampleIndex: 0, message: "stream failed" }];
    mocks.send.mockResolvedValueOnce(new Response("mock-native-stream"))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: "AQID" }] }));
    await consume({ prompt: "a quiet landscape", negative_prompt: "", qualityToggle: false, ucPreset: 3 });
    const native = JSON.parse(mocks.send.mock.calls[0][1].body);
    const buffered = JSON.parse(mocks.send.mock.calls[1][1].body);
    expect(native).toMatchObject({ input: "a quiet landscape", parameters: { qualityToggle: false, ucPreset: 3, negative_prompt: "" } });
    expect(buffered).toMatchObject({ prompt: "a quiet landscape", negative_prompt: "", qualityToggle: false, ucPreset: 3, quality_tags: "" });
  });

  it("keeps the same opt-out when streaming cannot initialize", async () => {
    mocks.send.mockResolvedValueOnce(new Response("not available", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: "AQID" }] }));
    const response = await POST(request({ prompt: "a quiet landscape", negative_prompt: "", qualityToggle: false, ucPreset: 3 }));
    expect(response.status).toBe(200);
    expect((await response.json()).images).toEqual(["data:image/png;base64,AQID"]);
    expect(JSON.parse(mocks.send.mock.calls[1][1].body)).toMatchObject({ prompt: "a quiet landscape", qualityToggle: false, quality_tags: "", negative_prompt: "", ucPreset: 3 });
  });
  it("returns the reserved history ID without waiting for the background write", async () => {
    mocks.history.mockImplementation(() => new Promise(() => {}));
    const { images, historyIds } = await consume();
    expect(images).toHaveLength(1);
    expect(historyIds).toHaveLength(1);
    expect(historyIds[0]).toMatch(/^[a-f\d-]{36}$/);
    expect(mocks.history).toHaveBeenCalledExactlyOnceWith(78601, expect.objectContaining({ _lfnRequestId: "stream-request" }), images, null, { imageIds: historyIds, requestId: "stream-request" });
  });

  it("keeps out-of-order samples paired with the saved images in a batch", async () => {
    mocks.events = [
      { eventType: "final", sampleIndex: 1, image: new Uint8Array([4, 5, 6]) },
      { eventType: "final", sampleIndex: 0, image: new Uint8Array([1, 2, 3]) },
    ];
    const { images, historyIds } = await consume({ n: 2 });
    expect(images).toEqual(["data:image/png;base64,AQID", "data:image/png;base64,BAUG"]);
    expect(new Set(historyIds).size).toBe(2);
    expect(mocks.history.mock.calls[0][2]).toEqual(images);
    expect(mocks.history.mock.calls[0][4].imageIds).toEqual(historyIds);
  });

  it("uses the same IDs on the streaming error/buffer fallback path", async () => {
    mocks.events = [{ eventType: "error", sampleIndex: 0, message: "stream failed" }];
    mocks.send.mockResolvedValueOnce(new Response("mock-native-stream"))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: "AQID" }] }));
    const { images, historyIds } = await consume();
    expect(images).toEqual(["data:image/png;base64,AQID"]);
    expect(mocks.history.mock.calls[0][4]).toEqual({ imageIds: historyIds, requestId: "stream-request" });
    expect(historyIds[0]).toMatch(/^[a-f\d-]{36}$/);
  });

  it.each([{ _lfnSkipServerHistory: true }, { editor_composite: true }])("does not reserve account IDs when server history is disabled: %j", async (extra) => {
    const { historyIds } = await consume(extra);
    expect(historyIds).toEqual([""]);
    if (extra.editor_composite) expect(mocks.history).not.toHaveBeenCalled();
  });
});
