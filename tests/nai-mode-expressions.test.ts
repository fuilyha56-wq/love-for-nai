import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

type Price = { billingExpr: string; billingMode: string; modelPrice: number };
const plan = JSON.parse(readFileSync(new URL("../docs/nai-mode-pricing-proposal-2026-10-23.json", import.meta.url), "utf8")) as { models: { model: string; before: Price; proposed: Price }[] };
// These reviewed expressions only use arithmetic, a comparison and tier().
function expressionValue(expr: string, p: number): number {
  return new Function("p", "c", "tier", "return " + expr)(p, 0, (_name: string, value: number) => value);
}

describe("NewAPI 待发布表达式区分固定标记和 1 Anlas 动态用量", () => {
  it("只修改八个完整模型的条件，保留收费系数和 ModelPrice", () => {
    expect(plan.models).toHaveLength(8);
    for (const row of plan.models) {
      expect(row.proposed.modelPrice).toBe(row.before.modelPrice);
      expect(row.proposed.billingMode).toBe(row.before.billingMode);
      expect(row.proposed.billingExpr.split("?")[1]).toBe(row.before.billingExpr.split("?")[1]);
    }
  });
  it.each(plan.models)("$model 固定档和动态结算均符合人民币单价", ({ model, before, proposed }) => {
    const ordinary = model.startsWith("nai-v4.5-");
    const marker = ordinary ? 1 : model.endsWith("-medium") ? 18 : 25;
    expect(expressionValue(proposed.billingExpr, marker)).toBe(expressionValue(before.billingExpr, marker));
    for (const anlas of [1, 2, 50, 90, 190]) {
      const value = expressionValue(proposed.billingExpr, anlas * 50);
      const quota = Math.round(value / 1_000_000 * 500_000);
      expect(quota / 100_000_000).toBeCloseTo(anlas * (ordinary ? 0.02 : 0.025), 8);
      expect(Math.round(value / 1_000_000 * 500_000 * 0)).toBe(0);
    }
  });
});
