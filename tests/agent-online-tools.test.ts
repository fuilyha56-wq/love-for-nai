import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ outboundFetch: vi.fn(), searchTagCatalog: vi.fn(), readCatalogTag: vi.fn() }));
vi.mock("@/lib/outbound", () => ({ outboundFetch: mocks.outboundFetch }));
vi.mock("@/lib/tag-catalog", () => ({ searchTagCatalog: mocks.searchTagCatalog, readCatalogTag: mocks.readCatalogTag, tagCatalogStatus: () => ({ available: true }) }));
import { runTool } from "@/lib/agent-tools";
beforeEach(() => vi.clearAllMocks());
describe("explicit online Danbooru tools", () => {
  it.each([
    ["search_danbooru_tags", { query: "white hair" }, "autocomplete.json", [{ value: "white_hair", category: 0, post_count: 100 }]],
    ["verify_danbooru_tag", { name: "white hair" }, "tags.json", [{ name: "white_hair", category: 0, post_count: 100 }]],
    ["read_danbooru_wiki", { title: "white hair" }, "wiki_pages.json", [{ title: "white_hair", body: "A complete online definition.", other_names: ["白发"] }]],
  ])("%s really requests the online endpoint", async (tool, args, endpoint, payload) => {
    mocks.outboundFetch.mockResolvedValueOnce(Response.json(payload));
    const result = await runTool(tool, args);
    expect(result).toMatchObject({ ok: true, data: { source: "danbooru_online" } });
    expect(mocks.outboundFetch.mock.calls[0][0]).toContain(`https://danbooru.donmai.us/${endpoint}?`);
    expect(mocks.searchTagCatalog).not.toHaveBeenCalled();
    expect(mocks.readCatalogTag).not.toHaveBeenCalled();
  });
});
