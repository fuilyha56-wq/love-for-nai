import { describe, expect, it } from "vitest";
import { commitNumberDraft } from "@/app/ui/wheel-number";
import {
  quoteDailyImage,
  DEFAULT_DAILY_IMAGE_POLICY,
} from "@/lib/daily-image-pricing";
describe("numeric field draft commit", () => {
  it.each(["", "-", "1e999", "NaN"])(
    "keeps a usable count for incomplete draft %s",
    (draft) => {
      const samples = commitNumberDraft(draft, 3, 1, 30, 1);
      expect(samples).toBe(3);
      expect(() =>
        quoteDailyImage(
          {
            model: "nai-v5-full",
            width: 832,
            height: 1216,
            steps: 28,
            samples,
          },
          DEFAULT_DAILY_IMAGE_POLICY,
          0.005,
          0,
        ),
      ).not.toThrow();
    },
  );
  it.each([
    ["0", 1],
    ["-5", 1],
    ["100", 30],
    ["1.5", 2],
    ["12", 12],
  ])(
    "bounds count %s without publishing invalid pricing inputs",
    (draft, expected) =>
      expect(commitNumberDraft(draft as string, 1, 1, 30, 1)).toBe(expected),
  );
  it("keeps fractional CFG values and clamps their bounds", () => {
    expect(commitNumberDraft("5.5", 5, 0, 10, 0.1)).toBe(5.5);
    expect(commitNumberDraft("100", 5, 0, 10, 0.1)).toBe(10);
  });
});
