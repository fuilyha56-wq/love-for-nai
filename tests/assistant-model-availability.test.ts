import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantModelIds } from "@/lib/assistant-models";
import { loadNewApiModels } from "@/lib/provider/newapi-models";

vi.mock("@/lib/newapi", () => ({ resolvedNewApiBaseUrl: async () => "https://newapi.test", userHeaders: () => ({ Authorization: "Bearer fixture" }) }));
vi.mock("@/lib/runtime-config", () => ({ isNaiModelEnabled: async () => true }));
afterEach(() => vi.unstubAllGlobals());

describe("live assistant model classification", () => {
  it("permits image understanding while excluding image output, Draw channels and embeddings", async () => {
    const fetch = vi.fn(async (input: string) => input.endsWith("/api/pricing")
      ? Response.json({ data: [{ model_name: "custom-draw", enable_groups: ["Draw"] }] })
      : Response.json({ data: [
          { id: "vision-chat", modalities: ["text", "image"] }, { id: "gpt-4o" }, { id: "text-embedding-3" },
          { id: "custom-output", output_modalities: ["image"] },
          { id: "custom-image-endpoint", supported_endpoint_types: { images: "/v1/images/generations" } },
          "custom-draw", "gpt-image-1", "nai-v5-full",
          "[官]gemini-2.5-flash-image", "[官]gemini-2.5-flash-image-preview", "[企]gemini-2.5-pro",
          "microsoft/mai-image-2.6", "microsoft/mai-image-2.6-flash", "BAAI/bge-m3",
        ] }));
    vi.stubGlobal("fetch", fetch);
    const items = await loadNewApiModels({ userId: 1 } as Parameters<typeof loadNewApiModels>[0]);
    expect(assistantModelIds(items)).toEqual(["[企]gemini-2.5-pro", "gpt-4o", "vision-chat"]);
    expect(fetch).toHaveBeenCalledWith("https://newapi.test/api/user/models", expect.objectContaining({ cache: "no-store" }));
  });
});
