import { describe, expect, it } from "vitest";
import {
  planImageTileUpscale,
  tileUpscaleConcurrencyLimit,
  TILE_UPSCALE_EDGE,
  TILE_UPSCALE_MAX_FREE_PIXELS,
  TILE_UPSCALE_MAX_TILES,
} from "@/lib/image-tile-upscale";

describe("分块超分规划", () => {
  it("生成 2× 图像的 1024 边长以内请求，并用重叠区覆盖完整画面", () => {
    const plan = planImageTileUpscale(832, 1216, 2);
    expect(plan.outputWidth).toBe(1664);
    expect(plan.outputHeight).toBe(2432);
    expect(plan.tiles).toHaveLength(6);
    expect(plan.tiles.every((tile) => tile.requestWidth <= TILE_UPSCALE_EDGE && tile.requestHeight <= TILE_UPSCALE_EDGE)).toBe(true);

    const coverage = new Uint8Array(plan.sourceWidth * plan.sourceHeight);
    for (const tile of plan.tiles) {
      for (let y = tile.coreY; y < tile.coreY + tile.coreHeight; y += 1) {
        coverage.fill(1, y * plan.sourceWidth + tile.coreX, y * plan.sourceWidth + tile.coreX + tile.coreWidth);
      }
    }
    expect(coverage.every((value) => value === 1)).toBe(true);
  });

  it("支持 2× 到 6×，并让常见竖图的 6× 自动切块保持在请求上限内", () => {
    for (const scale of [2, 3, 4, 5, 6] as const) {
      const plan = planImageTileUpscale(832, 1216, scale);
      expect(plan.outputWidth).toBe(832 * scale);
      expect(plan.outputHeight).toBe(1216 * scale);
      expect(plan.tiles.length).toBeLessThanOrEqual(TILE_UPSCALE_MAX_TILES);
      expect(plan.tiles.every((tile) => tile.requestWidth % 64 === 0 && tile.requestHeight % 64 === 0)).toBe(true);
      expect(plan.tiles.every((tile) => tile.requestWidth <= TILE_UPSCALE_EDGE && tile.requestHeight <= TILE_UPSCALE_EDGE)).toBe(true);
      expect(plan.tiles.every((tile) => tile.requestWidth * tile.requestHeight <= TILE_UPSCALE_MAX_FREE_PIXELS)).toBe(true);
      const worstAspect = plan.tiles.map((tile) => ({ tile, drift: Math.abs(Math.log((tile.requestWidth / tile.requestHeight) / (tile.sourceWidth / tile.sourceHeight))) })).sort((a, b) => b.drift - a.drift)[0];
      expect(worstAspect.drift, `${scale}× tile ${worstAspect.tile.index + 1}: request ${worstAspect.tile.requestWidth}×${worstAspect.tile.requestHeight}, source ${worstAspect.tile.sourceWidth}×${worstAspect.tile.sourceHeight}`).toBeLessThan(0.15);
    }
    const sixTimes = planImageTileUpscale(832, 1216, 6);
    expect(sixTimes.outputWidth).toBe(4992);
    expect(sixTimes.outputHeight).toBe(7296);
    expect(sixTimes.tiles).toHaveLength(63);
  });

  it("拒绝超过浏览器安全上限的输出和不支持的倍率", () => {
    expect(() => planImageTileUpscale(4096, 4096, 2)).toThrow(/目标图过大/);
    expect(() => planImageTileUpscale(256, 256, 7 as 2)).toThrow(/仅支持 2× 至 6×/);
    expect(TILE_UPSCALE_MAX_TILES).toBe(64);
  });

  it("按 Gateway 当前模型与免费档位选择并发账号池", () => {
    const capacity = { total: 8, v5: 5, v45: 8, anlas: 3, v5_and_anlas: 2, v45_and_anlas: 3, concurrency: 8 };
    expect(tileUpscaleConcurrencyLimit("nai-v5-full", 28, capacity)).toBe(5);
    expect(tileUpscaleConcurrencyLimit("nai-v5-full", 29, capacity)).toBe(2);
    expect(tileUpscaleConcurrencyLimit("nai-v4.5-full", 29, capacity)).toBe(3);
    expect(tileUpscaleConcurrencyLimit("some-other-image-model", 28, capacity)).toBe(8);
  });
});
