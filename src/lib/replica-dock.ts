// Presentation contract adapted from Aaalice_NAI_Launcher (MIT):
// agent_chat_dock_state.dart, agent_chat_dock_provider.dart, agent_chat_dock_contract.dart.
export type ReplicaDockMode = "exclusive" | "stacked" | "side-by-side";
export type ReplicaDockPane = "history" | "assistant";
export type ReplicaDockAvailability = { historyEnabled?: boolean; assistantEnabled?: boolean };
export type ReplicaDockExpansionRequest = { revision: number; expanded: boolean };
export type ReplicaDockState = {
  mode: ReplicaDockMode;
  expanded: boolean;
  activePane: ReplicaDockPane;
  foldedPane: ReplicaDockPane | null;
  historyFraction: number;
  chatWidth: number;
  floating: boolean;
  floatingVisible: boolean;
  floatingRect: { x: number; y: number; width: number; height: number } | null;
};

export const REPLICA_DOCK_SPLITTER = 8;
export const REPLICA_HISTORY_MIN_HEIGHT = 160;
export const REPLICA_ASSISTANT_MIN_HEIGHT = 280;
export const REPLICA_HISTORY_MIN_WIDTH = 200;
export const REPLICA_ASSISTANT_MIN_WIDTH = 240;
export const REPLICA_DOCK_SIDE_BY_SIDE_MIN_WIDTH = REPLICA_HISTORY_MIN_WIDTH + REPLICA_ASSISTANT_MIN_WIDTH + REPLICA_DOCK_SPLITTER;

export function createReplicaDockState(historyOpen = false, assistantOpen = false): ReplicaDockState {
  return {
    mode: historyOpen && assistantOpen ? "stacked" : "exclusive",
    expanded: historyOpen || assistantOpen,
    activePane: assistantOpen ? "assistant" : "history",
    foldedPane: null,
    historyFraction: .5,
    chatWidth: 360,
    floating: false,
    floatingVisible: true,
    floatingRect: null,
  };
}

const clamp = (value: unknown, fallback: number, minimum: number, maximum: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;

export function normalizeReplicaDockState(value: unknown, fallback = createReplicaDockState()): ReplicaDockState {
  if (!value || typeof value !== "object") return fallback;
  const saved = value as Partial<ReplicaDockState>;
  const rect = saved.floatingRect;
  const validRect = rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
  return {
    mode: saved.mode === "stacked" || saved.mode === "side-by-side" || saved.mode === "exclusive" ? saved.mode : fallback.mode,
    expanded: typeof saved.expanded === "boolean" ? saved.expanded : fallback.expanded,
    activePane: saved.activePane === "history" || saved.activePane === "assistant" ? saved.activePane : fallback.activePane,
    foldedPane: saved.foldedPane === "history" || saved.foldedPane === "assistant" ? saved.foldedPane : null,
    historyFraction: clamp(saved.historyFraction, .5, .2, .8),
    chatWidth: clamp(saved.chatWidth, 360, REPLICA_ASSISTANT_MIN_WIDTH, 960),
    floating: saved.floating === true,
    floatingVisible: saved.floatingVisible !== false,
    floatingRect: validRect ? { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(240, rect.width), height: Math.max(280, rect.height) } : null,
  };
}

export type ReplicaDockAction =
  | { type: "expansion"; expanded: boolean }
  | { type: "reveal"; pane: ReplicaDockPane }
  | { type: "collapse"; pane: ReplicaDockPane }
  | { type: "mode"; mode: ReplicaDockMode }
  | { type: "split"; historyFraction?: number; chatWidth?: number }
  | { type: "float" }
  | { type: "dock" }
  | { type: "floating-visible"; visible: boolean }
  | { type: "floating-rect"; rect: NonNullable<ReplicaDockState["floatingRect"]> };

export function reduceReplicaDock(state: ReplicaDockState, action: ReplicaDockAction, { historyEnabled = true, assistantEnabled = true }: ReplicaDockAvailability = {}): ReplicaDockState {
  if ((action.type === "reveal" || action.type === "collapse") && !(action.pane === "history" ? historyEnabled : assistantEnabled)) return state;
  if ((action.type === "float" || action.type === "dock" || action.type === "floating-visible" || action.type === "floating-rect") && !assistantEnabled) return state;
  switch (action.type) {
    case "expansion": {
      if (!action.expanded) return { ...state, expanded: false };
      if (!historyEnabled && !assistantEnabled) return state;
      const pane: ReplicaDockPane = historyEnabled ? "history" : "assistant";
      return { ...state, expanded: true, activePane: state.mode === "exclusive" ? pane : state.activePane, foldedPane: state.foldedPane === pane ? null : state.foldedPane };
    }
    case "reveal":
      if (action.pane === "assistant" && state.floating) return { ...state, floatingVisible: true };
      return { ...state, expanded: true, activePane: state.mode === "exclusive" ? action.pane : state.activePane, foldedPane: state.foldedPane === action.pane ? null : state.foldedPane };
    case "collapse":
      if (action.pane === "assistant" && state.floating) return { ...state, floatingVisible: false };
      if (!historyEnabled || !assistantEnabled) return { ...state, expanded: false };
      if (state.mode !== "exclusive" && !state.floating && state.foldedPane === null) return { ...state, foldedPane: action.pane };
      return { ...state, expanded: false };
    case "mode": return { ...state, mode: action.mode, foldedPane: null };
    case "split": return { ...state, historyFraction: clamp(action.historyFraction, state.historyFraction, .2, .8), chatWidth: clamp(action.chatWidth, state.chatWidth, REPLICA_ASSISTANT_MIN_WIDTH, 960) };
    case "float": return { ...state, floating: true, floatingVisible: true };
    case "dock": return { ...state, floating: false, expanded: true, activePane: state.mode === "exclusive" ? "assistant" : state.activePane, foldedPane: state.foldedPane === "assistant" ? null : state.foldedPane };
    case "floating-visible": return { ...state, floatingVisible: action.visible };
    case "floating-rect": return { ...state, floatingRect: action.rect };
  }
}

// Module availability changes presentation without overwriting device preferences.
// Re-enabling a module restores its selected mode, split geometry and floating state.
export function resolveAvailableReplicaDockState(state: ReplicaDockState, { historyEnabled = true, assistantEnabled = true }: ReplicaDockAvailability = {}): ReplicaDockState {
  if (historyEnabled && assistantEnabled) return state;
  const floating = state.floating && assistantEnabled;
  return {
    ...state,
    mode: "exclusive",
    activePane: historyEnabled ? "history" : "assistant",
    foldedPane: null,
    expanded: (historyEnabled || assistantEnabled) && state.expanded && (!floating || historyEnabled),
    floating,
    floatingVisible: floating && state.floatingVisible,
  };
}

export function resolveReplicaDockLayout(savedState: ReplicaDockState, width: number, availability: ReplicaDockAvailability = {}) {
  const state = resolveAvailableReplicaDockState(savedState, availability);
  const { historyEnabled = true, assistantEnabled = true } = availability;
  const split = state.mode !== "exclusive" && !state.floating;
  const horizontal = split && state.mode === "side-by-side" && width >= REPLICA_DOCK_SIDE_BY_SIDE_MIN_WIDTH;
  return {
    horizontal,
    historyOpen: historyEnabled && state.expanded && (state.floating || (split ? state.foldedPane !== "history" : state.activePane === "history")),
    assistantOpen: assistantEnabled && (state.floating ? state.floatingVisible : state.expanded && (split ? state.foldedPane !== "assistant" : state.activePane === "assistant")),
    restorePane: state.expanded && split ? state.foldedPane : null,
  };
}

export function resolveDockSplit(requestedHistoryHeight: number, availableHeight: number): { historyHeight: number; assistantHeight: number } {
  const usable = Math.max(0, Number.isFinite(availableHeight) ? availableHeight - REPLICA_DOCK_SPLITTER : 0);
  const scale = Math.min(1, usable / (REPLICA_HISTORY_MIN_HEIGHT + REPLICA_ASSISTANT_MIN_HEIGHT));
  const minimum = REPLICA_HISTORY_MIN_HEIGHT * scale;
  const maximum = usable - REPLICA_ASSISTANT_MIN_HEIGHT * scale;
  const historyHeight = Math.min(maximum, Math.max(minimum, Number.isFinite(requestedHistoryHeight) ? requestedHistoryHeight : minimum));
  return { historyHeight, assistantHeight: usable - historyHeight };
}

export function resolveDockColumns(requestedChatWidth: number, availableWidth: number): { historyWidth: number; assistantWidth: number } {
  const usable = Math.max(0, Number.isFinite(availableWidth) ? availableWidth - REPLICA_DOCK_SPLITTER : 0);
  const scale = Math.min(1, usable / (REPLICA_HISTORY_MIN_WIDTH + REPLICA_ASSISTANT_MIN_WIDTH));
  const minimum = REPLICA_ASSISTANT_MIN_WIDTH * scale;
  const maximum = usable - REPLICA_HISTORY_MIN_WIDTH * scale;
  const assistantWidth = Math.min(maximum, Math.max(minimum, Number.isFinite(requestedChatWidth) ? requestedChatWidth : minimum));
  return { historyWidth: usable - assistantWidth, assistantWidth };
}
