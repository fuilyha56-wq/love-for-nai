import { describe, expect, it } from "vitest";
import { parseAppearancePreferences } from "@/lib/appearance-store";

describe("外观偏好解析", () => {
  it("接受 nai 主题与靛蓝强调色", () => {
    const parsed = parseAppearancePreferences({
      version: 1,
      theme: "nai",
      accentPreset: "indigo",
    });
    expect(parsed.theme).toBe("nai");
    expect(parsed.accentPreset).toBe("indigo");
  });

  it("未知主题回退到默认宣纸", () => {
    const parsed = parseAppearancePreferences({
      version: 1,
      theme: "official-clone",
      accentPreset: "rose",
    });
    expect(parsed.theme).toBe("paper");
  });
});
