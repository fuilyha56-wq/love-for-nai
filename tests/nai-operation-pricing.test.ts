import { describe, expect, it } from "vitest";
import { externalGeneration } from "@/lib/compat-api";
import { affCost, estimateNewApiCost, estimateTokens, officialNaiAnlasCost, snapshotFromRawPricing } from "@/lib/image-pricing";
import { naiNativeGenerationBody } from "@/lib/nai-native-request";
import { DEFAULT_DAILY_IMAGE_POLICY, quoteDailyImage } from "@/lib/daily-image-pricing";
import { validateNaiGenerationCost } from "@/lib/image-request";

const base = { model: "nai-v5-full", width: 2048, height: 1536, steps: 28, n: 1 };
const raw = "iVBORw0KGgo";
const cached = "A".repeat(2700);
const cases: [string, Record<string, unknown>, number, number][] = [
  ["文生图忽略图生图滑块", { operation: "generate", strength: 0.2 }, 90, 455],
  ["图生图默认强度", { operation: "img2img", image: raw }, 63, 320],
  ["图生图自定义强度", { operation: "img2img", strength: 0.55, image: raw }, 50, 255],
  ["图生图最低费用", { operation: "img2img", strength: 0, image: raw }, 2, 15],
  ["局部重绘使用独立强度", { operation: "inpainting", strength: 0.2, image: raw, mask: raw }, 90, 455],
  ["编辑强度", { operation: "edits", inpaintImg2ImgStrength: 0.55, image: raw, mask: raw }, 50, 255],
  ["扩图强度", { operation: "outpainting", inpaintImg2ImgStrength: 0.55, image: raw, mask: raw }, 50, 255],
  ["V4.5 图生图", { model: "nai-v4.5-full", operation: "img2img", image: raw }, 42, 169],
  ["Medium 图生图", { model: "nai-v5-full-medium", steps: 14, operation: "img2img", image: raw }, 36, 181],
  ["Vibe 原始图编码", { operation: "vibe-transfer", reference_images: [raw] }, 92, 465],
  ["Vibe 缓存复用", { operation: "vibe-transfer", reference_images: [cached] }, 90, 455],
  ["角色参考", { operation: "character-reference", characters: [{ reference_image: raw }] }, 92, 465],
  ["精准参考", { operation: "precise-reference", references: [{ reference_image: raw }] }, 95, 480],
  ["精准参考叠加 Vibe", { operation: "precise-reference", references: [{ reference_image: raw }], reference_images: [raw] }, 97, 490],
  ["超过四张缓存 Vibe", { operation: "vibe-transfer", width: 1024, height: 1024, steps: 23, reference_images: Array(5).fill(cached) }, 28, 145],
  ["图生图两张", { operation: "img2img", image: raw, n: 2 }, 126, 640],
  ["精准参考两张", { operation: "precise-reference", references: [{ reference_image: raw }], n: 2 }, 190, 960],
  ["Vibe 两张只编码一次", { operation: "vibe-transfer", reference_images: [raw], n: 2 }, 182, 920],
];

// Historical review prices are explicit fixtures; live daily defaults may change.
const REVIEW_DAILY_POLICY = { ...DEFAULT_DAILY_IMAGE_POLICY, v45AnlasCny: 0.02, v5AnlasCny: 0.025 };

describe("全部生成模式的请求、预估与结算", () => {
  it.each(cases)("%s", (_, override, anlas, aff) => {
    const body = { ...base, ...override };
    const generation = externalGeneration(body);
    expect(generation).not.toBeNull();
    expect(officialNaiAnlasCost(generation!)).toBe(anlas);
    expect(affCost(generation!)).toBe(aff);
    expect(quoteDailyImage(generation!, REVIEW_DAILY_POLICY, 0.005, 0)).toMatchObject({ anlas, costAff: aff });
    expect(estimateTokens(generation!)).toBe(anlas * 50);
    const native = naiNativeGenerationBody(body);
    const roundTrip = externalGeneration(native);
    expect(roundTrip).not.toBeNull();
    expect(officialNaiAnlasCost(roundTrip!)).toBe(anlas);
    expect(affCost(roundTrip!)).toBe(aff);
  });

  it.each(["inpainting", "infill", "edits", "outpainting"])("%s payload fixes default mask strength at one", (operation) => {
    expect(naiNativeGenerationBody({ ...base, operation, strength: 0.2 }).parameters).toMatchObject({ inpaintImg2ImgStrength: 1 });
  });

  it.each([[1024, 1024, 1], [1280, 1280, 2], [1536, 1536, 3], [2048, 1536, 4]])("超分 %dx%d: %d Anlas，无固定生图费", (width, height, anlas) => {
    const generation = { model: "nai-v5-full", width, height, steps: 1, samples: 1, operation: "upscale" };
    const pricing = snapshotFromRawPricing(generation.model, { billing_mode: "tiered_expr", billing_expr: 'p == 25 ? tier("limit", p * 0 + c * 0 + 8000000) : tier("full", p * 100000 + c * 0)' }, 1);
    expect(affCost(generation)).toBe(anlas * 5);
    expect(estimateTokens(generation)).toBe(anlas * 50);
    expect(estimateNewApiCost(pricing, generation)).toBe(anlas * 5);
    expect(quoteDailyImage(generation, REVIEW_DAILY_POLICY, 0.005, 0)).toBeNull();
  });

  it.each(["declutter", "lineart", "sketch", "colorize", "emotion", "bg-removal"])("Director %s 保留独立工具费用", (tool) => {
    const anlas = tool === "bg-removal" ? 65 : 5;
    const generation = { ...base, samples: 1, operation: "director-" + tool };
    expect(affCost(generation)).toBe(anlas * 5);
    expect(quoteDailyImage(generation, REVIEW_DAILY_POLICY, 0.005, 100)).toBeNull();
  });

  it("Vibe 编码单独收费且不进入每日生图阶梯", () => {
    const generation = { ...base, samples: 1, operation: "encode-vibe", referenceImageCount: 1 };
    expect(affCost(generation)).toBe(10);
    expect(quoteDailyImage(generation, REVIEW_DAILY_POLICY, 0.005, 100)).toBeNull();
  });

  it("Limit 在扣款前拒绝付费参考图和超额缓存参考图", () => {
    const body = { model: "nai-v5-full-limit", width: 1024, height: 1024, steps: 28 };
    expect(externalGeneration({ ...body, reference_images: Array(4).fill(cached) })).not.toBeNull();
    expect(externalGeneration({ ...body, reference_images: Array(5).fill(cached) })).toBeNull();
    expect(externalGeneration({ ...body, reference_images: [raw] })).toBeNull();
    expect(externalGeneration({ ...body, references: [{ reference_image: raw }] })).toBeNull();
    expect(externalGeneration({ ...body, n: 2 })).toBeNull();
  });

  it("单张费用上限按实际操作强度验证", () => {
    expect(() => validateNaiGenerationCost(base.model, base.width, base.height, 50, 0.55, "img2img")).not.toThrow();
    expect(() => validateNaiGenerationCost(base.model, base.width, base.height, 50, 0.55, "generate")).toThrow(/140/);
    for (const strength of [-0.1, 1.1, NaN]) {
      expect(() => validateNaiGenerationCost(base.model, base.width, base.height, 28, strength, "inpainting")).toThrow(/强度/);
    }
  });

  it("原生缓存引用和新增引用合并计数，空别名不能隐藏费用", () => {
    const body = { ...base, parameters: { reference_image_multiple: [], reference_images: [raw], reference_image_multiple_cached: [{ cache_secret_key: "existing" }] } };
    const generation = externalGeneration(body);
    expect(generation).toMatchObject({ vibeReferenceImageCount: 2, encodedVibeCount: 1 });
    expect(officialNaiAnlasCost(generation!)).toBe(92);
  });
});
