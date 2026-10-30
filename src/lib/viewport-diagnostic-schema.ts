/** Numeric-only, temporary viewport investigation. Never add text or input data. */
export const VIEWPORT_DIAGNOSTIC_VERSION = 1;
export const VIEWPORT_DIAGNOSTIC_MAX_ROWS = 1200;
export const VIEWPORT_DIAGNOSTIC_MAX_BYTES = 256 * 1024;
export const VIEWPORT_DIAGNOSTIC_CAPTURE_RE = /^[a-f0-9]{32}$/i;
export const VIEWPORT_DIAGNOSTIC_DURATION_MS = 20_000;

export const VIEWPORT_DIAGNOSTIC_EVENT = {
  start: 1 << 0,
  geometry_frame: 1 << 1,
  heartbeat: 1 << 2,
  end: 1 << 3,
  visual_resize: 1 << 4,
  visual_scroll: 1 << 5,
  window_resize: 1 << 6,
  window_scroll: 1 << 7,
  element_scroll: 1 << 8,
  focus_in: 1 << 9,
  focus_out: 1 << 10,
  selection_change: 1 << 11,
  composition_start: 1 << 12,
  composition_end: 1 << 13,
  keyboard_geometry: 1 << 14,
  root_resize: 1 << 15,
  body_resize: 1 << 16,
  portal_resize: 1 << 17,
  visibility_change: 1 << 18,
  after_event_frame: 1 << 19,
} as const;

export const VIEWPORT_DIAGNOSTIC_ACTIVE_KIND = { none: 0, body: 1, textarea: 2, input: 3, editable: 4, other: 5 } as const;
export const VIEWPORT_DIAGNOSTIC_SOURCE = { unknown: 0, visual: 1, keyboard: 2 } as const;

/** Missing elements or unsupported measurements use -1. Coordinates may be negative. */
export const VIEWPORT_DIAGNOSTIC_COLUMNS = [
  "elapsed_ms", "event_mask", "inner_height", "inner_width", "root_client_height",
  "vv_height", "vv_width", "vv_top", "vv_left", "vv_scale", "vv_page_top",
  "dvh_height", "applied_height", "applied_top", "window_scroll_y", "secure_context", "vk_available",
  "body_scroll_top", "body_top", "body_height",
  "root_scroll_top", "root_top", "root_height",
  "main_scroll_top", "main_top", "main_height",
  "backdrop_scroll_top", "backdrop_top", "backdrop_height",
  "dialog_scroll_top", "dialog_top", "dialog_height",
  "pane_scroll_top", "pane_top", "pane_height",
  "panel_scroll_top", "panel_top", "panel_height",
  "transcript_scroll_top", "transcript_top", "transcript_height",
  "composer_scroll_top", "composer_top", "composer_height",
  "textarea_scroll_top", "textarea_top", "textarea_height",
  "body_client_height", "body_scroll_height", "root_scroll_height", "main_client_height", "main_scroll_height",
  "active_kind", "viewport_source", "vk_y", "vk_height", "vk_overlay", "meta_resizes_content", "document_hidden",
] as const;

export type ViewportDiagnosticColumn = typeof VIEWPORT_DIAGNOSTIC_COLUMNS[number];
export const VIEWPORT_DIAGNOSTIC_INDEX = Object.fromEntries(VIEWPORT_DIAGNOSTIC_COLUMNS.map((name, index) => [name, index])) as Record<ViewportDiagnosticColumn, number>;
export const VIEWPORT_DIAGNOSTIC_BOUNDS: readonly (readonly [number, number])[] = VIEWPORT_DIAGNOSTIC_COLUMNS.map(name => {
  if (name === "elapsed_ms") return [0, 120_000];
  if (name === "event_mask") return [0, (1 << 20) - 1];
  if (name === "active_kind") return [0, 5];
  if (name === "viewport_source") return [0, 2];
  if (name === "vv_scale") return [-1, 100];
  if (["secure_context", "vk_available", "vk_overlay", "meta_resizes_content", "document_hidden"].includes(name)) return [-1, 1];
  return [-1_000_000, 1_000_000];
});

export type ViewportDiagnosticPayload = {
  capture: string;
  version: typeof VIEWPORT_DIAGNOSTIC_VERSION;
  rows: number[][];
};
