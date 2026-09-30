import { describe, expect, it } from "vitest";
import { CUSTOM_LAYOUT_MODULES, parseCustomLayout, type CustomLayoutModule } from "@/lib/appearance-store";
import {
  CUSTOM_LAYOUT_EDITOR_MODULES,
  findDragInsertion,
  nudgeModule,
  orderForZone,
  reorderModule,
} from "@/lib/layout-editor";

const interleavedOrder: CustomLayoutModule[] = [
  "image", "history", "model", "prompt", "agent", "sampling", "references", "operations", "director",
];
function layoutWithInterleavedColumns() {
  return parseCustomLayout({ version: 3, moduleOrder: interleavedOrder });
}

describe("自定义布局分区排序", () => {
  it("每个可编辑模块都具有分区和说明，不限制卡片显隐", () => {
    expect(Object.keys(CUSTOM_LAYOUT_EDITOR_MODULES).sort()).toEqual([...CUSTOM_LAYOUT_MODULES].sort());
    for (const id of CUSTOM_LAYOUT_MODULES) {
      expect(CUSTOM_LAYOUT_EDITOR_MODULES[id].label).not.toBe("");
      expect(CUSTOM_LAYOUT_EDITOR_MODULES[id].detail).not.toBe("");
      expect(CUSTOM_LAYOUT_EDITOR_MODULES[id]).not.toHaveProperty("required");
    }
  });

  it("向下拖动可分别放在目标之前或之后，其他栏的卡片位置不变", () => {
    const layout = layoutWithInterleavedColumns();
    const before = reorderModule(layout, "image", "sampling", "before");
    const after = reorderModule(layout, "image", "sampling", "after");
    expect(orderForZone(before, "controls")).toEqual(["model", "prompt", "image", "sampling", "references", "operations", "director"]);
    expect(orderForZone(after, "controls")).toEqual(["model", "prompt", "sampling", "image", "references", "operations", "director"]);
    expect(after.moduleOrder[1]).toBe("history");
    expect(after.moduleOrder[4]).toBe("agent");
    expect(layout.moduleOrder).toEqual(interleavedOrder);
  });

  it("向上拖动可放在首个卡片之前，隐藏模块仍参与排序", () => {
    const layout = layoutWithInterleavedColumns();
    layout.visibleModules.references = false;
    const next = reorderModule(layout, "references", "image", "before");
    expect(orderForZone(next, "controls")).toEqual(["references", "image", "model", "prompt", "sampling", "operations", "director"]);
    expect(next.visibleModules.references).toBe(false);
    expect(next.visibleModules).toBe(layout.visibleModules);
    expect(next.modulePositions).toBe(layout.modulePositions);
  });

  it("拖至空白处仅追加至原栏末尾", () => {
    const layout = layoutWithInterleavedColumns();
    const next = reorderModule(layout, "history", null, "after");
    expect(orderForZone(next, "tools")).toEqual(["agent", "history"]);
    expect(orderForZone(next, "controls")).toEqual(orderForZone(layout, "controls"));
    expect(next.moduleOrder[1]).toBe("agent");
    expect(next.moduleOrder[4]).toBe("history");
  });

  it("跨栏、自身、已处于插入位置时不产生修改", () => {
    const layout = layoutWithInterleavedColumns();
    expect(reorderModule(layout, "image", "history", "before")).toBe(layout);
    expect(reorderModule(layout, "image", "image", "after")).toBe(layout);
    expect(reorderModule(layout, "image", "model", "before")).toBe(layout);
    expect(reorderModule(layout, "director", null, "after")).toBe(layout);
  });

  it("上下按钮跳过另一栏卡片，并在栏首栏尾停止", () => {
    const layout = layoutWithInterleavedColumns();
    const next = nudgeModule(layout, "model", -1);
    expect(orderForZone(next, "controls").slice(0, 3)).toEqual(["model", "image", "prompt"]);
    expect(next.moduleOrder[1]).toBe("history");
    expect(nudgeModule(layout, "image", -1)).toBe(layout);
    expect(nudgeModule(layout, "director", 1)).toBe(layout);
    expect(orderForZone(nudgeModule(layout, "history", 1), "tools")).toEqual(["agent", "history"]);
  });
});

describe("拖动插入位置", () => {
  const rects = [
    { id: "image" as const, top: 100, bottom: 200 },
    { id: "model" as const, top: 212, bottom: 332 },
    { id: "prompt" as const, top: 344, bottom: 504 },
  ];

  it("目标的上下半区对应不同插入边，向下拖动不会跳过目标", () => {
    expect(findDragInsertion(rects, "image", 240)).toEqual({ id: "model", edge: "before" });
    expect(findDragInsertion(rects, "image", 300)).toEqual({ id: "model", edge: "after" });
    const layout = layoutWithInterleavedColumns();
    const target = findDragInsertion(rects, "image", 300)!;
    expect(orderForZone(reorderModule(layout, "image", target.id, target.edge), "controls").slice(0, 3)).toEqual(["model", "image", "prompt"]);
  });

  it("跳过拖动卡片，首尾空白可插入栏首或栏尾", () => {
    expect(findDragInsertion(rects, "prompt", 50)).toEqual({ id: "image", edge: "before" });
    expect(findDragInsertion(rects, "image", 700)).toEqual({ id: "prompt", edge: "after" });
    expect(findDragInsertion(rects, "model", 280)).toEqual({ id: "prompt", edge: "before" });
    expect(findDragInsertion(rects, "prompt", 206)).toEqual({ id: "model", edge: "before" });
  });

  it("中点作为下半区边界，空栏和无效几何不产生插入目标", () => {
    expect(findDragInsertion(rects, "prompt", 150)).toEqual({ id: "image", edge: "after" });
    expect(findDragInsertion([], "image", 100)).toBeNull();
    expect(findDragInsertion([rects[0]], "image", 100)).toBeNull();
    expect(findDragInsertion(rects, "image", Number.NaN)).toBeNull();
    expect(findDragInsertion([{ id: "model", top: 20, bottom: 10 }], "image", 15)).toBeNull();
  });
});
