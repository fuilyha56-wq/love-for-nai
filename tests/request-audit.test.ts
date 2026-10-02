import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRequestAudit, startRequestAudit } from "@/lib/request-audit";
import { resetRuntimeConfigCache, updateRuntimeSettings } from "@/lib/runtime-config";

const originalDataDir = process.env.LFN_DATA_DIR;
afterEach(() => {
  resetRuntimeConfigCache();
  if (originalDataDir == null) delete process.env.LFN_DATA_DIR;
  else process.env.LFN_DATA_DIR = originalDataDir;
});

describe("request audit", () => {
  it("stores a stable safe fingerprint and redacts sensitive/image bodies", async () => {
    process.env.LFN_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "lfn-audit-"));
    resetRuntimeConfigCache();
    await updateRuntimeSettings({ trustProxy: true });
    const request = new Request("https://love-for-nai.test/v1/images/generations", {
      headers: { "x-forwarded-for": "203.0.113.8", "user-agent": "test-agent", authorization: "Bearer secret" },
    });
    const audit = await startRequestAudit({ request, source: "api", endpoint: "/v1/images/generations", userId: 4, parameters: { prompt: "hello", token: "secret", image: "data:image/png;base64,aGVsbG8=" } });
    await audit.finish({ status: 200, historyIds: ["image-1"] });
    const stored = await findRequestAudit(audit.requestId);
    expect(stored).toMatchObject({ requestId: audit.requestId, status: 200, historyIds: ["image-1"] });
    expect(stored?.parameters.token).toBe("[redacted]");
    expect(stored?.parameters.image).toMatchObject({ type: "image", bytes: 5 });
    expect(stored?.clientIpHash).toHaveLength(64);
    expect(audit.responseHeaders().get("X-LFN-Request-ID")).toBe(audit.requestId);
  });
});
