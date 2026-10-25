import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { officialNaiAnlasCost, gatewayAnlasCost, affCost, estimatePoints, estimateTokens, CNY_PER_AFF, pointPriceCny } from "@/lib/image-pricing";
import { CNY_PER_AFF as dailyAff, DEFAULT_DAILY_IMAGE_POLICY, quoteDailyImage } from "@/lib/daily-image-pricing";
import { naiDimensionLimit, naiImageSizeError } from "@/lib/nai-image-limits";
import { normalizeImageModelSize } from "@/lib/image-model-capabilities";
import { validateNaiGenerationCost } from "@/lib/image-request";

describe("官网报价与人民币收费对照", () => {
  const quotes = [
    ["nai-v5-full", 1024, 1536, 28, 45, 230],
    ["nai-v5-full", 2048, 1536, 23, 77, 390],
    ["nai-v5-full", 2048, 1536, 28, 90, 455],
    ["nai-v5-full", 4096, 768, 23, 77, 390],
    ["nai-v5-full", 2048, 1536, 46, 140, 705],
    ["nai-v5-full-medium", 2048, 1536, 14, 51, 256],
    ["nai-v4.5-full", 2048, 1536, 28, 60, 241],
    ["nai-v4.5-full", 2048, 1536, 50, 100, 401],
  ] as const;
  it.each(quotes)("%s %dx%d %d steps: %d Anlas, %d AFF at tier one", (model, width, height, steps, anlas, aff) => {
    const generation = { model, width, height, steps, samples: 1 };
    expect(officialNaiAnlasCost(generation)).toBe(anlas);
    expect(gatewayAnlasCost(generation)).toBe(anlas);
    expect(estimateTokens(generation)).toBe(anlas * 50);
    expect(affCost(generation)).toBe(aff);
    expect(quoteDailyImage(generation, DEFAULT_DAILY_IMAGE_POLICY, CNY_PER_AFF, 0)).toMatchObject({ anlas, costAff: aff, costCny: Number((aff * CNY_PER_AFF).toFixed(8)) });
  });
  it("keeps official compute and the V5 sales markup distinct", () => {
    expect(pointPriceCny("nai-v4.5-full")).toBe(0.02);
    expect(pointPriceCny("nai-v5-full")).toBe(0.025);
    expect(dailyAff).toBe(0.005);
    const generation = { model: "nai-v5-full", width: 2048, height: 1536, steps: 28, samples: 1 };
    expect([0, 50, 100, 200].map((count) => quoteDailyImage(generation, DEFAULT_DAILY_IMAGE_POLICY, dailyAff, count)?.costAff)).toEqual([455, 500.5, 511.875, 546]);
  });
  it("matches every row of the review CSV to the actual first-tier charge", () => {
    const csv = readFileSync(new URL("../docs/nai-pricing-final-2026-10-22.csv", import.meta.url), "utf8");
    const rows = csv.trim().split(/\r?\n/).slice(1);
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      const [label, size, steps, anlas, unitCny, dynamicAff, baseAff, totalAff, totalCny] = row.split(",");
      const [width, height] = size.split("×").map(Number);
      const model = label.startsWith("V4.5") ? "nai-v4.5-full" : label.includes("Medium") ? "nai-v5-full-medium" : "nai-v5-full";
      const generation = { model, width, height, steps: Number(steps.replace(/\D/g, "")), samples: 1 };
      expect(pointPriceCny(model)).toBe(Number(unitCny));
      expect(estimatePoints(generation)).toBe(Number(anlas));
      expect(Number(dynamicAff) + Number(baseAff)).toBe(Number(totalAff));
      expect(quoteDailyImage(generation, DEFAULT_DAILY_IMAGE_POLICY, dailyAff, 0)).toMatchObject({ costAff: Number(totalAff), costCny: Number(totalCny) });
    }
  });
  it("preserves the fixed-envelope fees and Medium's standard quote", () => {
    for (const [model, steps, baseAff, paidAnlas] of [["nai-v5-full", 23, 5, 26], ["nai-v5-full-medium", 14, 1, 18], ["nai-v4.5-full", 28, 1, 20]] as const) {
      const generation = { model, width: 1024, height: 1024, steps, samples: 1 };
      expect(officialNaiAnlasCost(generation)).toBe(paidAnlas);
      expect(officialNaiAnlasCost(generation, true)).toBe(0);
      expect(affCost(generation)).toBe(baseAff);
    }
  });
  it("enforces model area limits and the high-cost boundary before submission", () => {
    expect(naiImageSizeError("nai-v5-full", 2048, 1536)).toBeNull();
    expect(naiImageSizeError("nai-v5-full-limit", 832, 1216)).toBeNull();
    expect(naiImageSizeError("nai-v5-full-limit", 2048, 1536)).toMatch(/Limit/);
    expect(naiDimensionLimit(1216, "nai-v5-full-limit")).toBe(832);
    expect(naiDimensionLimit(1536, "nai-v5-full")).toBe(2048);
    expect(normalizeImageModelSize("nai-v5-full-medium", 2048, 1536)).toEqual({ width: 2048, height: 1536 });
    expect(normalizeImageModelSize("nai-v5-full-limit", 2048, 1536).width * normalizeImageModelSize("nai-v5-full-limit", 2048, 1536).height).toBeLessThanOrEqual(1_048_576);
    expect(() => validateNaiGenerationCost("nai-v5-full", 2048, 1536, 46)).not.toThrow();
    expect(() => validateNaiGenerationCost("nai-v5-full", 2048, 1536, 47)).toThrow(/140/);
    expect(() => validateNaiGenerationCost("nai-v5-full-limit", 1024, 1024, 29)).toThrow(/28/);
  });
});
