import type { CustomLayoutModule, CustomLayoutPreferences } from "@/lib/appearance-store";

export type LayoutEditorZone = "controls" | "tools";
export type LayoutDropEdge = "before" | "after";

export const CUSTOM_LAYOUT_EDITOR_MODULES: Record<
  CustomLayoutModule,
  { label: string; detail: string; zone: LayoutEditorZone }
> = {
  model: { label: "模型与模式", detail: "模型、内容类型和操作模式", zone: "controls" },
  prompt: { label: "提示词", detail: "正向、排除内容和角色", zone: "controls" },
  image: { label: "图像设置", detail: "尺寸与比例", zone: "controls" },
  sampling: { label: "采样与批次", detail: "步数、采样器和生成张数", zone: "controls" },
  operations: { label: "操作参数", detail: "源图、蒙版和工具参数", zone: "controls" },
  references: { label: "参考图片", detail: "图生图、图库和导入", zone: "controls" },
  director: { label: "导演工具", detail: "线稿、上色等图像工具", zone: "controls" },
  history: { label: "本次历史", detail: "当前会话生成结果", zone: "tools" },
  agent: { label: "标签助手", detail: "检索、分析与生成标签", zone: "tools" },
};

export function orderForZone(layout: CustomLayoutPreferences, zone: LayoutEditorZone): CustomLayoutModule[] {
  return layout.moduleOrder.filter((id) => CUSTOM_LAYOUT_EDITOR_MODULES[id].zone === zone);
}

/** Rearrange one column without changing the slots occupied by the other column. */
export function reorderModule(
  layout: CustomLayoutPreferences,
  id: CustomLayoutModule,
  targetId: CustomLayoutModule | null,
  edge: LayoutDropEdge,
): CustomLayoutPreferences {
  if (id === targetId || !layout.moduleOrder.includes(id)) return layout;
  const zone = CUSTOM_LAYOUT_EDITOR_MODULES[id].zone;
  const zoneOrder = orderForZone(layout, zone);
  if (targetId && (CUSTOM_LAYOUT_EDITOR_MODULES[targetId].zone !== zone || !zoneOrder.includes(targetId))) return layout;

  const reordered = zoneOrder.filter((item) => item !== id);
  const insertion = targetId ? reordered.indexOf(targetId) + (edge === "after" ? 1 : 0) : reordered.length;
  reordered.splice(insertion, 0, id);
  if (reordered.every((item, index) => item === zoneOrder[index])) return layout;

  let zoneIndex = 0;
  return {
    ...layout,
    moduleOrder: layout.moduleOrder.map((item) => (
      CUSTOM_LAYOUT_EDITOR_MODULES[item].zone === zone ? reordered[zoneIndex++] : item
    )),
  };
}

export function nudgeModule(
  layout: CustomLayoutPreferences,
  id: CustomLayoutModule,
  direction: -1 | 1,
): CustomLayoutPreferences {
  const zoneOrder = orderForZone(layout, CUSTOM_LAYOUT_EDITOR_MODULES[id].zone);
  const index = zoneOrder.indexOf(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= zoneOrder.length) return layout;
  return reorderModule(layout, id, zoneOrder[nextIndex], direction === -1 ? "before" : "after");
}

export type LayoutCardRect = { id: CustomLayoutModule; top: number; bottom: number };
export type LayoutDragInsertion = { id: CustomLayoutModule; edge: LayoutDropEdge };

/** Card midpoints select an insertion edge; the dragged card never targets itself. */
export function findDragInsertion(
  rects: readonly LayoutCardRect[],
  dragId: CustomLayoutModule,
  pointerY: number,
): LayoutDragInsertion | null {
  if (!Number.isFinite(pointerY)) return null;
  const targets = rects.filter(({ id, top, bottom }) => (
    id !== dragId && Number.isFinite(top) && Number.isFinite(bottom) && bottom >= top
  ));
  for (const rect of targets) {
    if (pointerY < (rect.top + rect.bottom) / 2) return { id: rect.id, edge: "before" };
    if (pointerY <= rect.bottom) return { id: rect.id, edge: "after" };
  }
  const last = targets.at(-1);
  return last ? { id: last.id, edge: "after" } : null;
}
