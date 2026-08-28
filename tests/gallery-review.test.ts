import { describe, expect, it } from "vitest";
import {
  assertGalleryRating,
  isRestrictedRating,
} from "@/lib/gallery";

describe("assertGalleryRating", () => {
  it("accepts the three supported ratings", () => {
    expect(assertGalleryRating("general")).toBe("general");
    expect(assertGalleryRating("r13")).toBe("r13");
    expect(assertGalleryRating("r18")).toBe("r18");
  });

  it("rejects unknown or legacy ratings", () => {
    expect(() => assertGalleryRating("sensitive")).toThrow();
    expect(() => assertGalleryRating("explicit")).toThrow();
    expect(() => assertGalleryRating(undefined)).toThrow();
  });
});

describe("isRestrictedRating", () => {
  it("only treats r18 as restricted", () => {
    expect(isRestrictedRating("r18")).toBe(true);
    expect(isRestrictedRating("r13")).toBe(false);
    expect(isRestrictedRating("general")).toBe(false);
  });
});
