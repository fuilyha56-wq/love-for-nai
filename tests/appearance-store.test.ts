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

  it("校验新版布局白名单、顺序、宽度与显隐", () => {
    const parsed = parseCustomLayout({
      version: CUSTOM_LAYOUT_VERSION,
      moduleOrder: ["agent", "agent", "unknown", "prompt"],
      visibleModules: { prompt: false, model: false, history: false },
      modulePositions: {
        agent: { x: -4, y: 99, width: 99, height: 0 },
        prompt: { x: 0, y: 0, width: 4, height: 2 },
      },
      leftWidth: 999,
      rightWidth: 1,
      rightCollapsed: true,
    });
    expect(parsed.moduleOrder).toEqual(["agent", "prompt", "model", "image", "sampling", "references", "operations", "history", "director"]);
    expect(parsed.visibleModules.prompt).toBe(false);
    expect(parsed.visibleModules.model).toBe(false);
    expect(parsed.visibleModules.history).toBe(false);
    expect(parsed.modulePositions.agent).toEqual({ x: 0, y: 7, width: 6, height: 1 });
    expect(parsed.modulePositions.prompt).toEqual({ x: 0, y: 0, width: 4, height: 2 });
    expect(parsed.leftWidth).toBe(520);
    expect(parsed.rightWidth).toBe(200);
    expect(parsed.rightCollapsed).toBe(true);
  });

  it("未知布局版本安全回退", () => {
    const parsed = parseCustomLayout({ version: 99, moduleOrder: ["agent"] });
    expect(parsed.version).toBe(CUSTOM_LAYOUT_VERSION);
    expect(parsed.moduleOrder).toHaveLength(9);
    expect(parsed.rightCollapsed).toBe(true);
  });

  it("新布局和旧默认顺序按官网左栏顺序排列，保留单卡设置", () => {
    const expected = ["model", "prompt", "references", "image", "operations", "director", "sampling", "history", "agent"];
    expect(parseCustomLayout(undefined).moduleOrder).toEqual(expected);
    const parsed = parseCustomLayout({ version: 3,
      moduleOrder: ["prompt", "model", "image", "sampling", "references", "operations", "history", "agent", "director"],
      moduleWidths: { image: 80 }, visibleModules: { director: false },
    });
    expect(parsed.moduleOrder).toEqual(expected);
    expect(parsed.moduleWidths?.image).toBe(80);
    expect(parsed.visibleModules.director).toBe(false);
  });

  it("迁移默认顺序不会重排用户移动过的卡片", () => {
    const order = ["image", "prompt", "model", "sampling", "references", "operations", "history", "agent", "director"];
    expect(parseCustomLayout({ version: 3, moduleOrder: order }).moduleOrder).toEqual(order);
  });

  it("右栏默认折叠，并保留显式展开偏好", () => {
    expect(parseCustomLayout(undefined).rightCollapsed).toBe(true);
    expect(parseCustomLayout({ version: CUSTOM_LAYOUT_VERSION, rightCollapsed: false }).rightCollapsed).toBe(false);
  });

  it("迁移 v1 列表布局到受限网格", () => {
    const parsed = parseCustomLayout({
      version: 1,
      moduleOrder: ["history", "prompt", "model"],
      visibleModules: { history: true },
    });
    expect(parsed.version).toBe(CUSTOM_LAYOUT_VERSION);
    expect(parsed.modulePositions.history).toEqual({ x: 0, y: 0, width: 4, height: 2 });
    expect(parsed.modulePositions.prompt).toEqual({ x: 4, y: 0, width: 4, height: 2 });
    expect(parsed.modulePositions.model).toEqual({ x: 8, y: 0, width: 4, height: 2 });
  });

  it("迁移 v2 时重新安置发生重叠的模块并保留必需模块", () => {
    const parsed = parseCustomLayout({
      version: 2,
      moduleOrder: ["prompt", "model"],
      visibleModules: { prompt: false, model: false },
      modulePositions: {
        prompt: { x: 0, y: 0, width: 4, height: 2 },
        model: { x: 0, y: 0, width: 4, height: 2 },
      },
    });
    expect(parsed.modulePositions.prompt).toEqual({ x: 0, y: 0, width: 4, height: 2 });
    expect(parsed.modulePositions.model).toEqual({ x: 4, y: 0, width: 4, height: 2 });
    expect(parsed.visibleModules.prompt).toBe(true);
    expect(parsed.visibleModules.model).toBe(true);
  });

  it("新版纵向布局保留隐藏状态与相邻模块高度", () => {
    const parsed = parseCustomLayout({
      version: CUSTOM_LAYOUT_VERSION,
      moduleOrder: ["model", "prompt"],
      visibleModules: { model: false },
      modulePositions: {
        model: { x: 0, y: 0, width: 4, height: 3 },
        prompt: { x: 0, y: 0, width: 4, height: 2 },
      },
    });
    expect(parsed.visibleModules.model).toBe(false);
    expect(parsed.moduleOrder.slice(0, 2)).toEqual(["model", "prompt"]);
    expect(parsed.modulePositions.model.height).toBe(3);
    expect(parsed.modulePositions.prompt.x).toBe(0);
  });

  it("丢弃本地 v4 自由网格，恢复远端稳定布局", () => {
    const parsed = parseCustomLayout({
      version: 4,
      moduleOrder: ["canvas", "generate", "navigation", "session"],
      modulePositions: { canvas: { x: 0, y: 8, width: 12, height: 4 } },
    });
    expect(parsed.version).toBe(3);
    expect(parsed.moduleOrder).toHaveLength(9);
    expect(parsed.moduleOrder).not.toContain("canvas");
    expect(parsed.modulePositions.prompt).toEqual({ x: 0, y: 0, width: 4, height: 2 });
    expect(parsed.rightCollapsed).toBe(true);
  });

  it("旧版 v3 没有单卡宽度时补齐 100%，保留已有模块设置", () => {
    const parsed = parseCustomLayout({
      version: CUSTOM_LAYOUT_VERSION,
      moduleOrder: ["image", "model", "prompt"],
      visibleModules: { image: false },
      modulePositions: { image: { x: 0, y: 0, width: 4, height: 3 } },
    });
    expect(Object.values(parsed.moduleWidths ?? {})).toEqual(Array(9).fill(100));
    expect(parsed.moduleOrder.slice(0, 3)).toEqual(["image", "model", "prompt"]);
    expect(parsed.visibleModules.image).toBe(false);
    expect(parsed.modulePositions.image.height).toBe(3);
  });

  it("分别限制单卡宽度，修复无效值并丢弃未知模块", () => {
    const parsed = parseCustomLayout({
      version: CUSTOM_LAYOUT_VERSION,
      moduleWidths: {
        image: 0,
        model: 180,
        prompt: 63.6,
        history: Number.NaN,
        agent: Number.POSITIVE_INFINITY,
        sampling: "80",
        unknown: 75,
      },
    });
    expect(parsed.moduleWidths).toEqual({
      image: 50,
      model: 100,
      prompt: 64,
      history: 100,
      agent: 100,
      sampling: 100,
      references: 100,
      operations: 100,
      director: 100,
    });
  });

  it("保存后的单卡尺寸和隐藏状态在 JSON 读回时保留", () => {
    const layout = parseCustomLayout({
      version: CUSTOM_LAYOUT_VERSION,
      moduleOrder: ["model", "image", "prompt"],
      moduleWidths: { image: 65, prompt: 90 },
      visibleModules: { image: false },
      modulePositions: { image: { x: 0, y: 0, width: 4, height: 4 } },
    });
    const parsed = parseCustomLayout(JSON.parse(JSON.stringify(layout)));
    expect(parsed).toEqual(layout);
    expect(parsed.moduleWidths?.image).toBe(65);
    expect(parsed.moduleWidths?.prompt).toBe(90);
    expect(parsed.visibleModules.image).toBe(false);
    expect(parsed.modulePositions.image.height).toBe(4);
  });

});
