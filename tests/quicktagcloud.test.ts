import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { outboundFetch } = vi.hoisted(() => ({ outboundFetch: vi.fn() }));
vi.mock("@/lib/outbound", () => ({ outboundFetch }));

const entries = { entries: [
  { id: "moon-1", title: "Moon composition", path: ["Scenery"], tags: "moon, detailed_sky, full_original_prompt", extra: { preserved: true } },
  { id: "other", title: "Other", tags: "unrelated_private_combination" },
] };
const codexes = [{ id: "composition", title: "Composition", entryCount: 2, dataUrl: "http://127.0.0.1/private" }];
const serialize = (data: unknown) => JSON.stringify(data);
const info = (data: unknown) => ({ size: Buffer.byteLength(serialize(data)), sha256: createHash("sha256").update(serialize(data)).digest("hex") });

beforeEach(() => {
  vi.resetModules();
  outboundFetch.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith("/current.json")) return Response.json({ release: "r-test" });
    if (url.endsWith("/manifest.json")) return Response.json({ files: { "codexes.json": info(codexes), "composition.json": info(entries) } });
    if (url.endsWith("/codexes.json")) return new Response(serialize(codexes));
    if (url.endsWith("/composition.json")) return new Response(serialize(entries));
    throw new Error(`Unexpected URL: ${url}`);
  });
});

describe("live QuickTagCloud tools", () => {
  it("lists the live release, searches a selected codex and reads only the chosen complete entry", async () => {
    const { runQuickTagCloudTool } = await import("@/lib/quicktagcloud");
    const list = await runQuickTagCloudTool("list_quicktagcloud_codexes", {});
    expect(list).toMatchObject({ ok: true, data: { source: "quicktagcloud_online", release: "r-test", codexes: [{ id: "composition" }] } });
    expect(outboundFetch).toHaveBeenCalledTimes(3);
    const search = await runQuickTagCloudTool("search_quicktagcloud_tags", { codexId: "composition", query: "moon" });
    expect(search).toMatchObject({ ok: true, data: { total: 1, entries: [{ entryId: "moon-1", hasPrompt: true }] } });
    expect(JSON.stringify(search)).not.toContain("full_original_prompt");
    expect(JSON.stringify(search)).not.toContain("unrelated_private_combination");
    const read = await runQuickTagCloudTool("read_quicktagcloud_entry", { codexId: "composition", entryId: "moon-1" });
    expect(read).toMatchObject({ ok: true, data: { found: true, entry: entries.entries[0], sourceUrl: expect.stringContaining("entry=moon-1") } });
    expect(outboundFetch).toHaveBeenCalledTimes(4);
    for (const [url] of outboundFetch.mock.calls) expect(url).toMatch(/^https:\/\/assets\.quicktagcloud\.com\/data\//);
  });

  it("does not use catalog-supplied URLs or accept path traversal", async () => {
    const { runQuickTagCloudTool } = await import("@/lib/quicktagcloud");
    const result = await runQuickTagCloudTool("search_quicktagcloud_tags", { codexId: "../../private", query: "moon" });
    expect(result).toMatchObject({ ok: false, data: { source: "quicktagcloud_online", message: expect.stringContaining("有效的 codexId") } });
    expect(outboundFetch).toHaveBeenCalledTimes(3);
  });

  it("rejects mismatched release files before returning their contents", async () => {
    const original = outboundFetch.getMockImplementation()!;
    outboundFetch.mockImplementation(async (url: string) => url.endsWith("/composition.json") ? Response.json({ entries: [{ id: "modified" }] }) : original(url));
    const { runQuickTagCloudTool } = await import("@/lib/quicktagcloud");
    const result = await runQuickTagCloudTool("search_quicktagcloud_tags", { codexId: "composition", query: "moon" });
    expect(result).toMatchObject({ ok: false, data: { message: expect.stringContaining("发布清单不符") } });
    expect(JSON.stringify(result)).not.toContain("modified");
  });

  it("reports network errors as online failures rather than pretending to have a fresh result", async () => {
    outboundFetch.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const { runQuickTagCloudTool } = await import("@/lib/quicktagcloud");
    expect(await runQuickTagCloudTool("list_quicktagcloud_codexes", {})).toMatchObject({ ok: false, data: { source: "quicktagcloud_online", message: expect.stringContaining("HTTP 403") } });
  });
});
