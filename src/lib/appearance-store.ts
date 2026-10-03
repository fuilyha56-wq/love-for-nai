export const APPEARANCE_STORAGE_KEY = "lfn-ui-preferences-v1";
export const APPEARANCE_PREFERENCES_VERSION = 1 as const;
export const CUSTOM_LAYOUT_STORAGE_KEY = "lfn-custom-layout-v1";
export const CUSTOM_LAYOUT_VERSION = 3 as const;
export const CUSTOM_LAYOUT_GRID_COLUMNS = 12 as const;
export const CUSTOM_LAYOUT_GRID_ROWS = 8 as const;
export const BACKGROUND_DB_NAME = "lfn-ui-background-v1";
export const BACKGROUND_STORE_NAME = "images";
const BACKGROUND_KEY = "current";

export type AppearanceTheme = "paper" | "dusk" | "night" | "nai";
export type AccentPreset = "rose" | "mint" | "gold" | "violet" | "indigo";
export type AppearanceDensity = "comfortable" | "compact";
export type AppearanceMotion = "full" | "reduced";
export type WorkspaceLayout = "lfn" | "nlw" | "custom";
export type HexColor = `#${string}`;

/** Keep the token source shared by the provider and the pre-paint script. */
export const APPEARANCE_THEME_TOKENS = {
  paper: {
    paper: "#f7f6f2",
    panel: "#fffefa",
    line: "#deddd7",
    ink: "#202328",
    muted: "#71767c",
  },
  dusk: {
    paper: "#eee9e4",
    panel: "#fffaf5",
    line: "#d8cbc2",
    ink: "#30282a",
    muted: "#796c6d",
  },
  night: {
    paper: "#17191d",
    panel: "#22252b",
    line: "#3a3e47",
    ink: "#f1eee8",
    muted: "#a6aab2",
  },
  nai: {
    paper: "#13152c",
    panel: "#191b31",
    line: "#22253f",
    ink: "#ffffff",
    muted: "#b3b4c8",
  },
} as const;

export const APPEARANCE_ACCENT_TOKENS = {
  rose: { base: "#a83a4c", dark: "#7f2637" },
  mint: { base: "#2d7567", dark: "#205649" },
  gold: { base: "#b47c2a", dark: "#805719" },
  violet: { base: "#7658a8", dark: "#503b7c" },
  indigo: { base: "#6c7fff", dark: "#4a57d6" },
} as const;

/** The only modules a custom workspace may arrange. Keep this list closed. */
export const CUSTOM_LAYOUT_MODULES = [
  "prompt",
  "model",
  "image",
  "sampling",
  "references",
  "operations",
  "history",
  "agent",
  "director",
] as const;
export type CustomLayoutModule = (typeof CUSTOM_LAYOUT_MODULES)[number];
export type CustomLayoutRect = { x: number; y: number; width: number; height: number };

export type CustomLayoutPreferences = {
  version: typeof CUSTOM_LAYOUT_VERSION;
  moduleOrder: CustomLayoutModule[];
  visibleModules: Record<CustomLayoutModule, boolean>;
  modulePositions: Record<CustomLayoutModule, CustomLayoutRect>;
  moduleWidths?: Partial<Record<CustomLayoutModule, number>>;
  leftWidth: number;
  rightWidth: number;
  rightCollapsed: boolean;
};

const DEFAULT_CUSTOM_MODULE_ORDER: CustomLayoutModule[] = [
  "model", "prompt", "references", "image", "operations", "director", "sampling", "history", "agent",
];
const DEFAULT_CUSTOM_MODULE_VISIBILITY: Record<CustomLayoutModule, boolean> = {
  prompt: true,
  model: true,
  image: true,
  sampling: true,
  references: true,
  operations: true,
  history: true,
  agent: true,
  director: true,
};

const DEFAULT_CUSTOM_MODULE_POSITIONS: Record<CustomLayoutModule, CustomLayoutRect> =
  Object.fromEntries(
    CUSTOM_LAYOUT_MODULES.map((moduleId, index) => [
      moduleId,
      {
        x: (index % 3) * 4,
        y: Math.floor(index / 3) * 2,
        width: 4,
        height: 2,
      },
    ]),
  ) as Record<CustomLayoutModule, CustomLayoutRect>;

const DEFAULT_CUSTOM_MODULE_WIDTHS = Object.fromEntries(
  CUSTOM_LAYOUT_MODULES.map((moduleId) => [moduleId, 100]),
) as Record<CustomLayoutModule, number>;

export const DEFAULT_CUSTOM_LAYOUT: CustomLayoutPreferences = {
  version: CUSTOM_LAYOUT_VERSION,
  moduleOrder: [...DEFAULT_CUSTOM_MODULE_ORDER],
  visibleModules: { ...DEFAULT_CUSTOM_MODULE_VISIBILITY },
  modulePositions: structuredClone(DEFAULT_CUSTOM_MODULE_POSITIONS),
  moduleWidths: { ...DEFAULT_CUSTOM_MODULE_WIDTHS },
  leftWidth: 310,
  rightWidth: 230,
  rightCollapsed: true,
};

// Explicit aliases keep the layout API discoverable for small client components.
export const DEFAULT_CUSTOM_LAYOUT_PREFERENCES = DEFAULT_CUSTOM_LAYOUT;
export const CUSTOM_LAYOUT_MODULE_IDS = CUSTOM_LAYOUT_MODULES;

const THEMES: AppearanceTheme[] = ["paper", "dusk", "night", "nai"];
const ACCENTS: AccentPreset[] = ["rose", "mint", "gold", "violet", "indigo"];
const DENSITIES: AppearanceDensity[] = ["comfortable", "compact"];
const MOTIONS: AppearanceMotion[] = ["full", "reduced"];
const WORKSPACE_LAYOUTS: WorkspaceLayout[] = ["lfn", "nlw", "custom"];

function cloneDefaultCustomLayout(): CustomLayoutPreferences {
  return {
    version: CUSTOM_LAYOUT_VERSION,
    moduleOrder: [...DEFAULT_CUSTOM_MODULE_ORDER],
    visibleModules: { ...DEFAULT_CUSTOM_MODULE_VISIBILITY },
    modulePositions: structuredClone(DEFAULT_CUSTOM_MODULE_POSITIONS),
    moduleWidths: { ...DEFAULT_CUSTOM_MODULE_WIDTHS },
    leftWidth: DEFAULT_CUSTOM_LAYOUT.leftWidth,
    rightWidth: DEFAULT_CUSTOM_LAYOUT.rightWidth,
    rightCollapsed: DEFAULT_CUSTOM_LAYOUT.rightCollapsed,
  };
}

function clampLayoutWidth(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function layoutPositionForIndex(index: number): CustomLayoutRect {
  return {
    x: (index % 3) * 4,
    y: Math.floor(index / 3) * 2,
    width: 4,
    height: 2,
  };
}

function parseLayoutRect(value: unknown, fallback: CustomLayoutRect): CustomLayoutRect {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  const record = value as Record<string, unknown>;
  const width = clampLayoutWidth(record.width, fallback.width, 2, 6);
  const height = clampLayoutWidth(record.height, fallback.height, 1, 4);
  const x = clampLayoutWidth(record.x, fallback.x, 0, CUSTOM_LAYOUT_GRID_COLUMNS - width);
  const y = clampLayoutWidth(record.y, fallback.y, 0, CUSTOM_LAYOUT_GRID_ROWS - height);
  return { x, y, width, height };
}

function overlaps(left: CustomLayoutRect, right: CustomLayoutRect): boolean {
  return !(
    left.x + left.width <= right.x || right.x + right.width <= left.x ||
    left.y + left.height <= right.y || right.y + right.height <= left.y
  );
}

function findAvailableLayoutRect(candidate: CustomLayoutRect, fallback: CustomLayoutRect, accepted: CustomLayoutRect[]): CustomLayoutRect {
  for (const preferred of [candidate, fallback]) {
    if (!accepted.some((rect) => overlaps(preferred, rect))) return { ...preferred };
  }
  for (const size of [candidate, fallback, { width: 2, height: 1 }]) {
    for (let y = 0; y <= CUSTOM_LAYOUT_GRID_ROWS - size.height; y += 1) {
      for (let x = 0; x <= CUSTOM_LAYOUT_GRID_COLUMNS - size.width; x += 1) {
        const next = { x, y, width: size.width, height: size.height };
        if (!accepted.some((rect) => overlaps(next, rect))) return next;
      }
    }
  }
  return { ...fallback };
}

/** Parse untrusted custom layout data with a closed module and numeric whitelist. */
export function parseCustomLayout(input: unknown): CustomLayoutPreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return cloneDefaultCustomLayout();
  }
  const record = input as Record<string, unknown>;
  if (record.version !== 1 && record.version !== 2 && record.version !== CUSTOM_LAYOUT_VERSION) return cloneDefaultCustomLayout();

  const order: CustomLayoutModule[] = [];
  if (Array.isArray(record.moduleOrder)) {
    for (const value of record.moduleOrder) {
      if (isOneOf(value, CUSTOM_LAYOUT_MODULES) && !order.includes(value)) order.push(value);
    }
  }
  // Only migrate the former untouched default; retain deliberate user ordering.
  if (!order.length || (order.length === CUSTOM_LAYOUT_MODULES.length && order.every((id, index) => id === CUSTOM_LAYOUT_MODULES[index]))) {
    order.splice(0, order.length, ...DEFAULT_CUSTOM_MODULE_ORDER);
  }
  for (const moduleId of CUSTOM_LAYOUT_MODULES) {
    if (!order.includes(moduleId)) order.push(moduleId);
  }

  const visibility = record.visibleModules;
  const visibleModules = { ...DEFAULT_CUSTOM_MODULE_VISIBILITY };
  if (visibility && typeof visibility === "object" && !Array.isArray(visibility)) {
    const values = visibility as Record<string, unknown>;
    for (const moduleId of CUSTOM_LAYOUT_MODULES) {
      if (typeof values[moduleId] === "boolean") visibleModules[moduleId] = values[moduleId];
    }
  }
  if (record.version !== CUSTOM_LAYOUT_VERSION) {
    visibleModules.prompt = true;
    visibleModules.model = true;
    visibleModules.operations = true;
  }
  const positionValues = record.modulePositions && typeof record.modulePositions === "object" && !Array.isArray(record.modulePositions)
    ? record.modulePositions as Record<string, unknown>
    : {};
  const modulePositions = {} as Record<CustomLayoutModule, CustomLayoutRect>;
  const accepted: CustomLayoutRect[] = [];
  order.forEach((moduleId, index) => {
    const fallback = layoutPositionForIndex(index);
    const candidate = record.version !== 1
      ? parseLayoutRect(positionValues[moduleId], fallback)
      : fallback;
    const next = record.version === CUSTOM_LAYOUT_VERSION ? candidate : findAvailableLayoutRect(candidate, fallback, accepted);
    modulePositions[moduleId] = { ...next };
    accepted.push(next);
  });

  const widthValues = record.moduleWidths && typeof record.moduleWidths === "object" && !Array.isArray(record.moduleWidths)
    ? record.moduleWidths as Record<string, unknown>
    : {};
  const moduleWidths = { ...DEFAULT_CUSTOM_MODULE_WIDTHS };
  for (const moduleId of CUSTOM_LAYOUT_MODULES) {
    moduleWidths[moduleId] = clampLayoutWidth(widthValues[moduleId], 100, 50, 100);
  }

  return {
    version: CUSTOM_LAYOUT_VERSION,
    moduleOrder: order,
    visibleModules,
    modulePositions,
    moduleWidths,
    leftWidth: clampLayoutWidth(record.leftWidth, DEFAULT_CUSTOM_LAYOUT.leftWidth, 240, 520),
    rightWidth: clampLayoutWidth(record.rightWidth, DEFAULT_CUSTOM_LAYOUT.rightWidth, 200, 460),
    rightCollapsed:
      typeof record.rightCollapsed === "boolean"
        ? record.rightCollapsed
        : DEFAULT_CUSTOM_LAYOUT.rightCollapsed,
  };
}

export const parseCustomLayoutPreferences = parseCustomLayout;

export function loadCustomLayout(): CustomLayoutPreferences {
  if (typeof window === "undefined") return cloneDefaultCustomLayout();
  try {
    const raw = window.localStorage.getItem(CUSTOM_LAYOUT_STORAGE_KEY);
    return raw ? parseCustomLayout(JSON.parse(raw)) : cloneDefaultCustomLayout();
  } catch {
    return cloneDefaultCustomLayout();
  }
}

export const readCustomLayout = loadCustomLayout;

export function saveCustomLayout(input: CustomLayoutPreferences): CustomLayoutPreferences {
  const normalized = parseCustomLayout(input);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CUSTOM_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Private browsing and quota limits should not prevent the UI from working.
    }
  }
  return normalized;
}

export const writeCustomLayout = saveCustomLayout;

export function resetCustomLayout(): CustomLayoutPreferences {
  const defaults = cloneDefaultCustomLayout();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CUSTOM_LAYOUT_STORAGE_KEY, JSON.stringify(defaults));
    } catch {
      // Private browsing and quota limits should not prevent the UI from working.
    }
  }
  return defaults;
}

export const restoreDefaultCustomLayout = resetCustomLayout;

export type AppearancePreferences = {
  version: typeof APPEARANCE_PREFERENCES_VERSION;
  theme: AppearanceTheme;
  accentPreset: AccentPreset;
  customAccent: HexColor | null;
  grid: boolean;
  density: AppearanceDensity;
  motion: AppearanceMotion;
  workspaceLayout: WorkspaceLayout;
  glass: boolean;
  glassStrength: number;
  // 关闭右侧栏自动折叠：开启后面板保持展开（不因鼠标离开自动收起），
  // 折叠后的历史缩略栏改为显示在功能栏左侧。默认 false = 保持现状。
  rightPanelKeepOpen: boolean;
  backgroundEnabled: boolean;
  backgroundPositionX: number; // 0–100，0 居左 100 居右
  backgroundPositionY: number; // 0–100，0 居上 100 居下
};

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  version: APPEARANCE_PREFERENCES_VERSION,
  theme: "paper",
  accentPreset: "rose",
  customAccent: null,
  grid: true,
  density: "comfortable",
  motion: "full",
  workspaceLayout: "lfn",
  glass: false,
  glassStrength: 42,
  // 面板常驻（不自动折叠）默认开启：功能栏保持展开，手动折叠变为图标栏。
  rightPanelKeepOpen: true,
  backgroundEnabled: false,
  backgroundPositionX: 50,
  backgroundPositionY: 50,
};

// Short aliases make the store convenient to consume from small client components.
export const DEFAULT_PREFERENCES = DEFAULT_APPEARANCE_PREFERENCES;

/**
 * Build the tiny synchronous bootstrap used by the root layout. Keep its
 * normalization rules in lockstep with parseAppearancePreferences so the
 * first paint and the ready provider never disagree about persisted values.
 */
export function createAppearancePrepaintScript(): string {
  const themes = JSON.stringify(APPEARANCE_THEME_TOKENS);
  const accents = JSON.stringify(APPEARANCE_ACCENT_TOKENS);
  const defaults = JSON.stringify(DEFAULT_APPEARANCE_PREFERENCES);
  return `(function(){try{
var THEMES=${themes};var ACCENTS=${accents};var DEFAULTS=${defaults};
var raw=localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});var input;
try{input=raw?JSON.parse(raw):null;}catch(e){input=null;}
var p=!input||typeof input!=="object"||Array.isArray(input)?DEFAULTS:
  (input.version!==undefined&&input.version!==${APPEARANCE_PREFERENCES_VERSION}?DEFAULTS:input);
var theme=Object.prototype.hasOwnProperty.call(THEMES,p.theme)?p.theme:DEFAULTS.theme;
var accentPreset=Object.prototype.hasOwnProperty.call(ACCENTS,p.accentPreset)?p.accentPreset:DEFAULTS.accentPreset;
var themeTokens=THEMES[theme];var accentTokens=ACCENTS[accentPreset];
var customAccent=typeof p.customAccent==="string"&&/^#[0-9a-fA-F]{6}$/.test(p.customAccent)?p.customAccent.toUpperCase():null;
var rose=customAccent||accentTokens.base;
var grid=typeof p.grid==="boolean"?p.grid:DEFAULTS.grid;
var glass=typeof p.glass==="boolean"?p.glass:DEFAULTS.glass;
var motion=p.motion==="reduced"||p.motion==="full"?p.motion:DEFAULTS.motion;
var density=p.density==="compact"||p.density==="comfortable"?p.density:DEFAULTS.density;
var strength=typeof p.glassStrength==="number"&&Number.isFinite(p.glassStrength)?Math.min(100,Math.max(0,Math.round(p.glassStrength))):DEFAULTS.glassStrength;
var root=document.documentElement,style=root.style;
root.dataset.theme=theme;root.dataset.glass=glass?"on":"off";root.dataset.motion=motion;
root.dataset.grid=grid?"on":"off";root.dataset.density=density;
style.setProperty("--paper",themeTokens.paper);style.setProperty("--panel",themeTokens.panel);style.setProperty("--line",themeTokens.line);
style.setProperty("--ink",themeTokens.ink);style.setProperty("--muted",themeTokens.muted);
style.setProperty("--rose",rose);style.setProperty("--rose-dark",customAccent?"color-mix(in srgb, "+rose+" 76%, #000)":accentTokens.dark);
style.setProperty("--mint",ACCENTS.mint.base);style.setProperty("--gold",ACCENTS.gold.base);
var glassAlpha=Math.round(46-strength*0.26),glassBlur=Math.round(12+strength*0.28);
style.setProperty("--lfn-glass-opacity",glass?String(0.5+strength/200):"0");style.setProperty("--lfn-glass-blur",glass?glassBlur+"px":"0px");
style.setProperty("--glass-alpha",glass?glassAlpha+"%":"100%");style.setProperty("--glass-blur",glass?glassBlur+"px":"0px");style.setProperty("--glass-saturation",glass?String(1.3+strength/250):"1");
var tint=theme==="nai"?"rgba(255, 255, 255, 0.03)":"rgba(56, 52, 45, 0.035)";
var layers=grid?["linear-gradient("+tint+" 1px, transparent 1px)","linear-gradient(90deg, "+tint+" 1px, transparent 1px)"]:[];
var body=document.body.style;body.backgroundImage=layers.join(", ")||"none";body.backgroundSize=layers.map(function(){return "24px 24px";}).join(", ")||"auto";
body.backgroundPosition=layers.map(function(){return "0 0";}).join(", ")||"0 0";body.backgroundAttachment=layers.map(function(){return "scroll";}).join(", ")||"scroll";body.backgroundColor=themeTokens.paper;
}catch(e){}})();`;
}

/** Only six-digit CSS hex colors are accepted as user supplied colors. */
export function isSafeHexColor(value: unknown): value is HexColor {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export const isValidHexColor = isSafeHexColor;

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function clampStrength(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_APPEARANCE_PREFERENCES.glassStrength;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampPercent(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Parse untrusted local data. A bad version falls back to the complete default,
 * while malformed individual fields are repaired independently.
 */
export function parseAppearancePreferences(input: unknown): AppearancePreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...DEFAULT_APPEARANCE_PREFERENCES };
  }

  const record = input as Record<string, unknown>;
  if (
    record.version !== undefined &&
    record.version !== APPEARANCE_PREFERENCES_VERSION
  ) {
    // 旧版本数据（v1 无背景位置字段）逐字段修复而不是整体丢弃，
    // parseAppearancePreferences 的字段级 fallback 会补上新增默认值。
    if (record.version !== 1) return { ...DEFAULT_APPEARANCE_PREFERENCES };
  }

  return {
    version: APPEARANCE_PREFERENCES_VERSION,
    theme: isOneOf(record.theme, THEMES)
      ? record.theme
      : DEFAULT_APPEARANCE_PREFERENCES.theme,
    accentPreset: isOneOf(record.accentPreset, ACCENTS)
      ? record.accentPreset
      : DEFAULT_APPEARANCE_PREFERENCES.accentPreset,
    customAccent: isSafeHexColor(record.customAccent)
      ? record.customAccent.toUpperCase() as HexColor
      : null,
    grid:
      typeof record.grid === "boolean"
        ? record.grid
        : DEFAULT_APPEARANCE_PREFERENCES.grid,
    density: isOneOf(record.density, DENSITIES)
      ? record.density
      : DEFAULT_APPEARANCE_PREFERENCES.density,
    motion: isOneOf(record.motion, MOTIONS)
      ? record.motion
      : DEFAULT_APPEARANCE_PREFERENCES.motion,
    workspaceLayout: isOneOf(record.workspaceLayout, WORKSPACE_LAYOUTS)
      ? record.workspaceLayout
      : DEFAULT_APPEARANCE_PREFERENCES.workspaceLayout,
    glass:
      typeof record.glass === "boolean"
        ? record.glass
        : DEFAULT_APPEARANCE_PREFERENCES.glass,
    glassStrength: clampStrength(record.glassStrength),
    rightPanelKeepOpen:
      typeof record.rightPanelKeepOpen === "boolean"
        ? record.rightPanelKeepOpen
        : DEFAULT_APPEARANCE_PREFERENCES.rightPanelKeepOpen,
    backgroundEnabled:
      typeof record.backgroundEnabled === "boolean"
        ? record.backgroundEnabled
        : DEFAULT_APPEARANCE_PREFERENCES.backgroundEnabled,
    backgroundPositionX: clampPercent(
      record.backgroundPositionX,
      DEFAULT_APPEARANCE_PREFERENCES.backgroundPositionX,
    ),
    backgroundPositionY: clampPercent(
      record.backgroundPositionY,
      DEFAULT_APPEARANCE_PREFERENCES.backgroundPositionY,
    ),
  };
}

export const parsePreferences = parseAppearancePreferences;

export function loadAppearancePreferences(): AppearancePreferences {
  if (typeof window === "undefined") {
    return { ...DEFAULT_APPEARANCE_PREFERENCES };
  }
  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return raw ? parseAppearancePreferences(JSON.parse(raw)) : { ...DEFAULT_APPEARANCE_PREFERENCES };
  } catch {
    return { ...DEFAULT_APPEARANCE_PREFERENCES };
  }
}

export const readAppearancePreferences = loadAppearancePreferences;
export const loadPreferences = loadAppearancePreferences;

export function saveAppearancePreferences(
  preferences: AppearancePreferences,
): AppearancePreferences {
  const normalized = parseAppearancePreferences(preferences);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Private browsing and quota limits should not prevent the UI from working.
    }
  }
  return normalized;
}

export const writeAppearancePreferences = saveAppearancePreferences;
export const savePreferences = saveAppearancePreferences;

function indexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openBackgroundDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!indexedDbAvailable()) {
      reject(new Error("当前浏览器不支持 IndexedDB"));
      return;
    }
    const request = window.indexedDB.open(BACKGROUND_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BACKGROUND_STORE_NAME)) {
        request.result.createObjectStore(BACKGROUND_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开本地背景存储失败"));
    request.onblocked = () => reject(new Error("本地背景存储被其他页面占用"));
  });
}

export async function saveBackgroundImage(image: Blob): Promise<void> {
  const database = await openBackgroundDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BACKGROUND_STORE_NAME, "readwrite");
      transaction.objectStore(BACKGROUND_STORE_NAME).put(image, BACKGROUND_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("保存本地背景失败"));
      transaction.onabort = () => reject(transaction.error || new Error("保存本地背景失败"));
    });
  } finally {
    database.close();
  }
}

export async function readBackgroundImage(): Promise<Blob | null> {
  if (!indexedDbAvailable()) return null;
  const database = await openBackgroundDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const transaction = database.transaction(BACKGROUND_STORE_NAME, "readonly");
      const request = transaction.objectStore(BACKGROUND_STORE_NAME).get(BACKGROUND_KEY);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value instanceof Blob ? value : null);
      };
      request.onerror = () => reject(request.error || new Error("读取本地背景失败"));
    });
  } finally {
    database.close();
  }
}

export async function deleteBackgroundImage(): Promise<void> {
  if (!indexedDbAvailable()) return;
  const database = await openBackgroundDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BACKGROUND_STORE_NAME, "readwrite");
      transaction.objectStore(BACKGROUND_STORE_NAME).delete(BACKGROUND_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("清除本地背景失败"));
      transaction.onabort = () => reject(transaction.error || new Error("清除本地背景失败"));
    });
  } finally {
    database.close();
  }
}

export const clearBackgroundImage = deleteBackgroundImage;
export const readLocalBackground = readBackgroundImage;
export const saveLocalBackground = saveBackgroundImage;
export const deleteLocalBackground = deleteBackgroundImage;
