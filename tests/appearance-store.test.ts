import { describe, expect, it } from "vitest";
import {
  CUSTOM_LAYOUT_VERSION,
  parseAppearancePreferences,
  parseCustomLayout,
} from "@/lib/appearance-store";

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

  it("校验版本、白名单、顺序、宽度并保留必需模块", () => {
    const parsed = parseCustomLayout({
      version: CUSTOM_LAYOUT_VERSION,
      moduleOrder: ["agent", "agent", "unknown", "prompt"],
      visibleModules: { prompt: false, model: false, history: false },
      leftWidth: 999,
      rightWidth: 1,
      rightCollapsed: true,
    });
    expect(parsed.moduleOrder).toEqual(["agent", "prompt", "model", "image", "sampling", "references", "operations", "history", "director"]);
    expect(parsed.visibleModules.prompt).toBe(true);
    expect(parsed.visibleModules.model).toBe(true);
    expect(parsed.visibleModules.history).toBe(false);
    expect(parsed.leftWidth).toBe(520);
    expect(parsed.rightWidth).toBe(200);
    expect(parsed.rightCollapsed).toBe(true);
  });

  it("未知布局版本安全回退", () => {
    const parsed = parseCustomLayout({ version: 99, moduleOrder: ["agent"] });
    expect(parsed.version).toBe(CUSTOM_LAYOUT_VERSION);
    expect(parsed.moduleOrder).toHaveLength(9);
  });

});
