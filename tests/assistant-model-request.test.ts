import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAssistantModel,
  type AssistantKeyAuth,
} from "@/lib/assistant-model-request";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/model-concurrency", () => ({ fetchWithModelConcurrency: send }));
const url = "http://newapi.test/v1/chat/completions";
const init = {
  method: "POST",
  body: JSON.stringify({ model: "deepseek-v4-pro", messages: [] }),
};
beforeEach(() => vi.resetAllMocks());

describe("bounded assistant key recovery", () => {
  it.each([undefined, "low", "medium", "high"])("defaults to high reasoning and respects a supported user choice=%s", async reasoning => {
    send.mockResolvedValueOnce(Response.json({ choices: [] }));
    const messages = [{ role: "user", content: "fixture" }];
    await fetchAssistantModel(url, { method: "POST", body: JSON.stringify({ model: "gpt-5.2", messages, ...(reasoning ? { reasoning_effort: reasoning } : {}) }) }, { key: "fixture" });
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ model: "gpt-5.2", messages, reasoning_effort: reasoning || "high" });
  });
  it("retries only the rejected request with a refreshed key and keeps it for later rounds", async () => {
    send
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "Invalid token (request id: test)" } },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ choices: [] }))
      .mockResolvedValueOnce(Response.json({ choices: [] }));
    const refreshKey = vi.fn().mockResolvedValue("new-key");
    const auth = { key: "old-key", refreshKey };
    expect((await fetchAssistantModel(url, init, auth)).ok).toBe(true);
    await fetchAssistantModel(url, init, auth);
    expect(refreshKey).toHaveBeenCalledExactlyOnceWith("old-key");
    expect(
      send.mock.calls.map(([, request]) =>
        new Headers(request.headers).get("Authorization"),
      ),
    ).toEqual(["Bearer old-key", "Bearer new-key", "Bearer new-key"]);
    expect(
      send.mock.calls.every(([, request]) => request.body === JSON.stringify({ ...JSON.parse(init.body), reasoning_effort: "high" })),
    ).toBe(true);
  });

  it("does not repeat a rejected request with the same freshly verified key", async () => {
    send.mockResolvedValue(
      Response.json({ message: "Invalid token" }, { status: 401 }),
    );
    const refreshKey = vi.fn().mockResolvedValue("same-key");
    await fetchAssistantModel(url, init, { key: "same-key", refreshKey });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([200, 400, 402, 429, 500, 502])(
    "does not retry status %i",
    async (status) => {
      send.mockResolvedValue(
        Response.json({ error: { message: "Invalid token" } }, { status }),
      );
      const refreshKey = vi.fn();
      await fetchAssistantModel(url, init, { key: "old", refreshKey });
      expect(refreshKey).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves provider errors and personal API keys without refreshing", async () => {
    send.mockResolvedValue(
      Response.json(
        { error: { message: "upstream provider authentication failed" } },
        { status: 401 },
      ),
    );
    const refreshKey = vi.fn();
    await fetchAssistantModel(url, init, { key: "old", refreshKey });
    expect(refreshKey).not.toHaveBeenCalled();
    send.mockResolvedValue(
      Response.json({ error: { message: "Invalid token" } }, { status: 401 }),
    );
    await fetchAssistantModel(url, init, { key: "personal" });
    expect(refreshKey).not.toHaveBeenCalled();
  });

  it("attempts recovery at most once per job", async () => {
    send.mockImplementation(async () =>
      Response.json({ error: { message: "Invalid token" } }, { status: 401 }),
    );
    const refreshKey = vi.fn().mockResolvedValue("new");
    const auth: AssistantKeyAuth = { key: "old", refreshKey };
    await fetchAssistantModel(url, init, auth);
    await fetchAssistantModel(url, init, auth);
    expect(refreshKey).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
