import { describe, expect, it } from "vitest";
import { findBlockedTerm } from "@/lib/gallery";

describe("findBlockedTerm", () => {
  it("allows common negative prompts with reverse words", () => {
    expect(
      findBlockedTerm(
        "1girl, white dress, garden",
        "lowres, nsfw, nude, bad anatomy",
        "blue hair",
      ),
    ).toBeNull();
  });

  it("blocks explicit terms in positive prompt", () => {
    expect(
      findBlockedTerm("1girl, nude, beach", "lowres", ""),
    ).toMatch(/nude/i);
  });

  it("blocks r18 in tags", () => {
    expect(findBlockedTerm("1girl", "lowres", "r18")).toMatch(/r18/i);
  });
});
