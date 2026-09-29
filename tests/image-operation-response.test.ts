import { describe, expect, it } from "vitest";
import { readImageOperationResponse } from "@/lib/image-operation-response";

describe("image operation responses", () => {
  it("preserves a JSON error so the caller can show its message", async () => {
    const response = Response.json({ message: "上游暂不可用" }, { status: 502 });
    await expect(readImageOperationResponse(response)).resolves.toEqual({ message: "上游暂不可用" });
  });

  it("reports the HTTP status instead of leaking an HTML parsing error", async () => {
    const response = new Response("<html><h1>Gateway Time-out</h1></html>", {
      status: 504,
      headers: { "Content-Type": "text/html" },
    });
    await expect(readImageOperationResponse(response)).rejects.toThrow(/HTTP 504.*核对图片历史和余额/);
  });

  it("handles malformed JSON with the same actionable status", async () => {
    const response = new Response("{", {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
    await expect(readImageOperationResponse(response)).rejects.toThrow(/HTTP 502/);
  });
});
