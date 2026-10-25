import { describe, expect, it } from "vitest";
import { imageHistoryReferences, readImageOperationResponse } from "@/lib/image-operation-response";

describe("image operation responses", () => {
  it("keeps image identities aligned across streaming, JSON and partial batches", () => {
    const batches = [
      imageHistoryReferences(["stream-a", "stream-b"], [], "stream-request"),
      imageHistoryReferences(["json"], ["json-history"], "json-request"),
      imageHistoryReferences(["partial-a", "partial-b"], [null, "partial-history"]),
    ];
    expect(batches.flatMap((batch) => batch.historyIds)).toEqual(["", "", "json-history", "", "partial-history"]);
    expect(batches.flatMap((batch) => batch.requestIds)).toEqual(["stream-request", "stream-request", "json-request", "", ""]);
  });

  it("preserves the JSON request identity for history reconciliation", async () => {
    const result = await readImageOperationResponse(Response.json({ images: ["image"], historyIds: [], requestId: "json-request" }));
    expect(imageHistoryReferences(result.images!, result.historyIds, result.requestId).requestIds).toEqual(["json-request"]);
  });

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
