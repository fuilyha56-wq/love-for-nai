import { describe, expect, it } from "vitest";
import {
  NAI_IMAGE_MODEL_CATALOG,
  NAI_INPAINT_MODEL_OPTIONS,
  NAI_MODEL_CATALOG,
  NAI_UPSCALE_MODEL_IDS,
  firstValidModel,
  isNaiCatalogImageModel,
  isNaiUpscaleModel,
} from "@/lib/nai-model-catalog";

describe("统一 NAI 模型目录", () => {
  it("exposes one canonical image/chat directory without duplicate IDs", () => {
    const ids = NAI_MODEL_CATALOG.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("nai-v5-full");
    expect(ids).toContain("nai-chat");
    expect(NAI_IMAGE_MODEL_CATALOG.every(({ kind }) => kind === "image")).toBe(true);
  });

  it("shares inpaint and upscale entries with the canonical directory", () => {
    expect(NAI_INPAINT_MODEL_OPTIONS.map(([id]) => id)).toEqual([
      "nai-v5-inpaint",
      "nai-v5-inpaint-limit",
      "nai-v4.5-inpaint",
      "nai-v4.5-inpaint-limit",
      "nai-v3-inpaint",
      "nai-v3-furry-inpaint",
    ]);
    expect(NAI_UPSCALE_MODEL_IDS).toEqual([
      "nai-diffusion-5-curated",
      "nai-diffusion-5-full",
    ]);
  });

  it("recognizes only canonical image models and supported upscale models", () => {
    expect(isNaiCatalogImageModel("nai-v5-full")).toBe(true);
    expect(isNaiCatalogImageModel("nai-chat")).toBe(false);
    expect(isNaiCatalogImageModel("nai-v9-preview")).toBe(false);
    expect(isNaiUpscaleModel("nai-diffusion-5-curated")).toBe(true);
    expect(isNaiUpscaleModel("nai-v5-full")).toBe(false);
  });

  it("falls back when a remembered option is no longer valid", () => {
    expect(firstValidModel("nai-v5-full", ["nai-v5-full", "nai-v3"], "nai-v3")).toBe("nai-v5-full");
    expect(firstValidModel("removed-model", ["nai-v5-full", "nai-v3"], "nai-v3")).toBe("nai-v5-full");
    expect(firstValidModel(null, [], "nai-v3")).toBe("nai-v3");
  });
});
