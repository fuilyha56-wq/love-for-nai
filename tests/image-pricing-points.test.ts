import { describe, expect, it } from "vitest";
import {
  estimateNewApiCost,
  estimatePointCny,
  estimatePoints,
  estimateTokens,
  parseTieredExpr,
  pointPriceCny,
  snapshotFromRawPricing,
  tokensToPoints,
} from "@/lib/image-pricing";

describe("私立积分展示价格", () => {
  it("按 50 token 向上取整为积分", () => {
    expect(tokensToPoints(49)).toBe(1);
    expect(tokensToPoints(50)).toBe(1);
    expect(tokensToPoints(51)).toBe(2);
    expect(tokensToPoints(1_000_000)).toBe(20_000);
  });

  it("V4.5 和 V5 使用不同的每积分人民币价格", () => {
    expect(pointPriceCny("nai-v4.5-full")).toBe(0.04);
    expect(pointPriceCny("nai-v5-full")).toBe(0.06);
    expect(pointPriceCny("nai-chat")).toBeNull();
  });

  it("计算器按整单 token 估算积分和人民币", () => {
    const v45 = {
      model: "nai-v4.5-full",
      width: 832,
      height: 1216,
      steps: 28,
      samples: 1,
    };
    const v5 = { ...v45, model: "nai-v5-full" };
    expect(estimateTokens(832, 1216, 1)).toBe(2023);
    expect(estimatePoints(v45)).toBe(41);
    expect(estimatePointCny(v45)).toBe(1.64);
    expect(estimatePointCny(v5)).toBe(2.46);
  });
});

describe("NewAPI 实时分档解析", () => {
  it("识别生产 base 表达式和旧的 limit/full 表达式", () => {
    expect(parseTieredExpr('tier("base", p * 240000 + c * 0)')).toEqual({
      kind: "base",
      coeff: 240000,
    });
    expect(
      parseTieredExpr('p < 100 ? tier("limit", p * 0) : tier("full", p * 100000)'),
    ).toEqual({ kind: "two_tier", limitCoeff: 0, fullCoeff: 100000 });
  });

  it("V5 档内按账单 960000 quota=$1.92，档外按 usage token 结算", () => {
    const snapshot = snapshotFromRawPricing(
      "nai-v5-full",
      {
        quota_type: 1,
        model_price: 200,
        billing_mode: "tiered_expr",
        billing_expr: 'tier("base", p * 240000 + c * 0)',
      },
      1,
      "Draw",
    );
    expect(snapshot.tiered).toBe(true);
    expect(snapshot.inEnvelopeUsd).toBe(1.92);
    expect(snapshot.outOfEnvelopeBalancePerUsageToken).toBe(0.24);
    expect(
      estimateNewApiCost(snapshot, {
        model: "nai-v5-full",
        width: 832,
        height: 1216,
        steps: 28,
        samples: 1,
      }),
    ).toBe(1.92);
    expect(
      estimateNewApiCost(snapshot, {
        model: "nai-v5-full",
        width: 832,
        height: 1216,
        steps: 29,
        samples: 1,
      }),
    ).toBe(Number((2023 * 0.24).toFixed(8)));
  });

  it("quota_type=1 的 -limit 模型仍按次计价，不把完整版的 200 当成实时价", () => {
    const snapshot = snapshotFromRawPricing(
      "nai-v5-full-limit",
      { quota_type: 1, model_price: 6 },
      1,
      "Draw",
    );
    expect(snapshot.tiered).toBeUndefined();
    expect(
      estimateNewApiCost(snapshot, {
        model: "nai-v5-full-limit",
        width: 832,
        height: 1216,
        steps: 28,
        samples: 1,
      }),
    ).toBe(6);
  });
});
