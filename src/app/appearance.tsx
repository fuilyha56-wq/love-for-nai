"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  deleteBackgroundImage,
  loadAppearancePreferences,
  parseAppearancePreferences,
  readBackgroundImage,
  saveAppearancePreferences,
  saveBackgroundImage,
  type AppearancePreferences,
  type AppearanceTheme,
} from "@/lib/appearance-store";

type ThemeTokens = {
  paper: string;
  panel: string;
  line: string;
  ink: string;
  muted: string;
};

const THEME_TOKENS: Record<AppearanceTheme, ThemeTokens> = {
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
};

const ACCENT_TOKENS = {
  rose: { base: "#a83a4c", dark: "#7f2637" },
  mint: { base: "#2d7567", dark: "#205649" },
  gold: { base: "#b47c2a", dark: "#805719" },
  violet: { base: "#7658a8", dark: "#503b7c" },
} as const;

type AppearanceContextValue = {
  preferences: AppearancePreferences;
  updatePreferences: (patch: Partial<AppearancePreferences>) => void;
  setPreferences: (preferences: AppearancePreferences) => void;
  resetPreferences: () => void;
  backgroundUrl: string | null;
  hasBackground: boolean;
  ready: boolean;
  saveBackground: (image: Blob) => Promise<void>;
  removeBackground: () => Promise<void>;
};

const AppearanceContext = createContext<AppearanceContextValue | undefined>(
  undefined,
);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferencesState] = useState<AppearancePreferences>(
    DEFAULT_APPEARANCE_PREFERENCES,
  );
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const backgroundRevision = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    // Defer restoration until after hydration so server and client markup agree.
    void Promise.resolve().then(() => {
      if (!active) return;
      setPreferencesState(loadAppearancePreferences());
      setReady(true);
    });
    const revision = ++backgroundRevision.current;
    void readBackgroundImage()
      .then((image) => {
        if (!active || revision !== backgroundRevision.current) return;
        setBackgroundUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return image ? URL.createObjectURL(image) : null;
        });
      })
      .catch(() => undefined);

    const syncFromAnotherTab = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_STORAGE_KEY || !event.newValue) return;
      try {
        setPreferencesState(parseAppearancePreferences(JSON.parse(event.newValue)));
      } catch {
        // Ignore malformed cross-tab data; the store will repair it on the next save.
      }
      const nextRevision = ++backgroundRevision.current;
      void readBackgroundImage()
        .then((image) => {
          if (!active || nextRevision !== backgroundRevision.current) return;
          setBackgroundUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return image ? URL.createObjectURL(image) : null;
          });
        })
        .catch(() => undefined);
    };
    window.addEventListener("storage", syncFromAnotherTab);
    return () => {
      active = false;
      window.removeEventListener("storage", syncFromAnotherTab);
    };
  }, []);

  useEffect(() => {
    if (ready) saveAppearancePreferences(preferences);
  }, [preferences, ready]);

  // Revoke object URLs when replacing or unmounting a provider.
  useEffect(
    () => () => {
      if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
    },
    [backgroundUrl],
  );

  useEffect(() => {
    const root = document.documentElement;
    const theme = THEME_TOKENS[preferences.theme];
    const accent = ACCENT_TOKENS[preferences.accentPreset];
    const rose = preferences.customAccent || accent.base;

    root.dataset.theme = preferences.theme;
    root.dataset.glass = preferences.glass ? "on" : "off";
    root.dataset.motion = preferences.motion;
    root.dataset.grid = preferences.grid ? "on" : "off";
    root.dataset.density = preferences.density;

    const showBackground = preferences.backgroundEnabled && Boolean(backgroundUrl);
    root.style.setProperty(
      "--paper",
      showBackground
        ? `color-mix(in srgb, ${theme.paper} 82%, transparent)`
        : theme.paper,
    );
    root.style.setProperty("--panel", theme.panel);
    root.style.setProperty("--line", theme.line);
    root.style.setProperty("--ink", theme.ink);
    root.style.setProperty("--muted", theme.muted);
    root.style.setProperty("--rose", rose);
    root.style.setProperty(
      "--rose-dark",
      preferences.customAccent
        ? `color-mix(in srgb, ${rose} 76%, #000)`
        : accent.dark,
    );
    root.style.setProperty("--mint", ACCENT_TOKENS.mint.base);
    root.style.setProperty("--gold", ACCENT_TOKENS.gold.base);
    // 玻璃曲线：0% 也要有明显的液态玻璃感（模糊 12px 起 + 饱和度提升 +
    // 半透明 + 边缘高光），强度只在此基础上继续增强。
    const glassAlpha = Math.round(46 - preferences.glassStrength * 0.26);
    const glassBlur = Math.round(12 + preferences.glassStrength * 0.28);
    root.style.setProperty(
      "--lfn-glass-opacity",
      preferences.glass ? String(0.5 + preferences.glassStrength / 200) : "0",
    );
    root.style.setProperty(
      "--lfn-glass-blur",
      preferences.glass ? `${glassBlur}px` : "0px",
    );
    root.style.setProperty("--glass-alpha", preferences.glass ? `${glassAlpha}%` : "100%");
    root.style.setProperty("--glass-blur", preferences.glass ? `${glassBlur}px` : "0px");
    root.style.setProperty(
      "--glass-saturation",
      preferences.glass ? String(1.3 + preferences.glassStrength / 250) : "1",
    );
    root.style.setProperty("--lfn-local-background", backgroundUrl ? `url("${backgroundUrl}")` : "none");
    root.style.setProperty(
      "--lfn-bg-pos",
      `${preferences.backgroundPositionX}% ${preferences.backgroundPositionY}%`,
    );

    // globals.css owns the default paper grid. Inline layers let this module
    // toggle it and add a local image without touching the shared stylesheet.
    const gridLayers = preferences.grid
      ? [
          "linear-gradient(rgba(56, 52, 45, 0.035) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(56, 52, 45, 0.035) 1px, transparent 1px)",
        ]
      : [];
    const imageLayer = preferences.backgroundEnabled && backgroundUrl
      ? [`url("${backgroundUrl}")`]
      : [];
    const imagePosition = `${preferences.backgroundPositionX}% ${preferences.backgroundPositionY}%`;
    document.body.style.backgroundImage = [...gridLayers, ...imageLayer].join(", ") || "none";
    document.body.style.backgroundSize = [
      ...gridLayers.map(() => "24px 24px"),
      ...imageLayer.map(() => "cover"),
    ].join(", ") || "auto";
    document.body.style.backgroundPosition = [
      ...gridLayers.map(() => "0 0"),
      ...imageLayer.map(() => imagePosition),
    ].join(", ") || "0 0";
    document.body.style.backgroundAttachment = [
      ...gridLayers.map(() => "scroll"),
      ...imageLayer.map(() => "fixed"),
    ].join(", ") || "scroll";
    document.body.style.backgroundColor = theme.paper;
  }, [backgroundUrl, preferences]);

  const setPreferences = useCallback((next: AppearancePreferences) => {
    setPreferencesState(parseAppearancePreferences(next));
  }, []);

  const updatePreferences = useCallback(
    (patch: Partial<AppearancePreferences>) => {
      setPreferencesState((current) =>
        parseAppearancePreferences({ ...current, ...patch }),
      );
    },
    [],
  );

  const resetPreferences = useCallback(() => {
    setPreferencesState({ ...DEFAULT_APPEARANCE_PREFERENCES });
  }, []);

  const saveBackground = useCallback(async (image: Blob) => {
    await saveBackgroundImage(image);
    backgroundRevision.current += 1;
    setBackgroundUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(image);
    });
    setPreferencesState((current) => ({ ...current, backgroundEnabled: true }));
  }, []);

  const removeBackground = useCallback(async () => {
    await deleteBackgroundImage();
    backgroundRevision.current += 1;
    setBackgroundUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    setPreferencesState((current) => ({ ...current, backgroundEnabled: false }));
  }, []);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      preferences,
      updatePreferences,
      setPreferences,
      resetPreferences,
      backgroundUrl,
      hasBackground: Boolean(backgroundUrl),
      ready,
      saveBackground,
      removeBackground,
    }),
    [
      backgroundUrl,
      preferences,
      ready,
      removeBackground,
      resetPreferences,
      saveBackground,
      setPreferences,
      updatePreferences,
    ],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error("useAppearance 必须在 AppearanceProvider 内使用");
  }
  return context;
}

export default AppearanceProvider;
