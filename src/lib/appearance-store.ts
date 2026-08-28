export const APPEARANCE_STORAGE_KEY = "lfn-ui-preferences-v1";
export const APPEARANCE_PREFERENCES_VERSION = 1 as const;
export const BACKGROUND_DB_NAME = "lfn-ui-background-v1";
export const BACKGROUND_STORE_NAME = "images";
const BACKGROUND_KEY = "current";

export type AppearanceTheme = "paper" | "dusk" | "night";
export type AccentPreset = "rose" | "mint" | "gold" | "violet";
export type AppearanceDensity = "comfortable" | "compact";
export type AppearanceMotion = "full" | "reduced";
export type HexColor = `#${string}`;

export type AppearancePreferences = {
  version: typeof APPEARANCE_PREFERENCES_VERSION;
  theme: AppearanceTheme;
  accentPreset: AccentPreset;
  customAccent: HexColor | null;
  grid: boolean;
  density: AppearanceDensity;
  motion: AppearanceMotion;
  glass: boolean;
  glassStrength: number;
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
  glass: false,
  glassStrength: 42,
  backgroundEnabled: false,
  backgroundPositionX: 50,
  backgroundPositionY: 50,
};

// Short aliases make the store convenient to consume from small client components.
export const DEFAULT_PREFERENCES = DEFAULT_APPEARANCE_PREFERENCES;

const THEMES: AppearanceTheme[] = ["paper", "dusk", "night"];
const ACCENTS: AccentPreset[] = ["rose", "mint", "gold", "violet"];
const DENSITIES: AppearanceDensity[] = ["comfortable", "compact"];
const MOTIONS: AppearanceMotion[] = ["full", "reduced"];

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
    glass:
      typeof record.glass === "boolean"
        ? record.glass
        : DEFAULT_APPEARANCE_PREFERENCES.glass,
    glassStrength: clampStrength(record.glassStrength),
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
