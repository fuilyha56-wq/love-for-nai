import { findFeatureTutorial } from "./feature-tutorials";

export const FEATURE_TUTORIAL_EVENT = "lfn-feature-tutorial-change";
export const FEATURE_TUTORIAL_SESSION_KEY = "lfn-feature-tutorial-session-v1";
export const FEATURE_TUTORIAL_RESULT_KEY = "lfn-feature-tutorial-result-v1";
export const FEATURE_TUTORIAL_PROGRESS_KEY = "lfn-feature-tutorial-progress-v1";
export type TutorialSession = { tutorialId: string; stepIndex: number };
export type TutorialResult = { tutorialId: string; completed: boolean };
let memorySession: TutorialSession | null = null;

export function parseTutorialSession(value: string | null): TutorialSession | null {
  try {
    const session = JSON.parse(value || "null");
    const tutorial = session && typeof session.tutorialId === "string" ? findFeatureTutorial(session.tutorialId) : undefined;
    return tutorial && Number.isInteger(session.stepIndex) && session.stepIndex >= 0 && session.stepIndex < tutorial.steps.length
      ? { tutorialId: tutorial.id, stepIndex: session.stepIndex } : null;
  } catch { return null; }
}

export function readTutorialSession(): TutorialSession | null {
  if (typeof window === "undefined") return null;
  try { return memorySession = parseTutorialSession(window.sessionStorage.getItem(FEATURE_TUTORIAL_SESSION_KEY)) ?? memorySession; }
  catch { return memorySession; }
}

export function writeTutorialSession(session: TutorialSession | null) {
  memorySession = session;
  try {
    if (session) window.sessionStorage.setItem(FEATURE_TUTORIAL_SESSION_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(FEATURE_TUTORIAL_SESSION_KEY);
  } catch { /* The current tour remains usable without browser storage. */ }
  window.dispatchEvent(new Event(FEATURE_TUTORIAL_EVENT));
}

export function startFeatureTutorial(tutorialId: string) {
  if (!findFeatureTutorial(tutorialId)) return;
  writeTutorialSession({ tutorialId, stepIndex: 0 });
}

export function finishFeatureTutorial(session: TutorialSession, completed: boolean) {
  try {
    window.sessionStorage.setItem(FEATURE_TUTORIAL_RESULT_KEY, JSON.stringify({ tutorialId: session.tutorialId, completed }));
    if (completed) {
      const progress = JSON.parse(window.localStorage.getItem(FEATURE_TUTORIAL_PROGRESS_KEY) || "{}");
      window.localStorage.setItem(FEATURE_TUTORIAL_PROGRESS_KEY, JSON.stringify({ ...progress, [session.tutorialId]: true }));
    }
  } catch { /* Completion never depends on storage availability. */ }
  writeTutorialSession(null);
}

export function readTutorialResult(): TutorialResult | null {
  try {
    const result = JSON.parse(window.sessionStorage.getItem(FEATURE_TUTORIAL_RESULT_KEY) || "null");
    return result && findFeatureTutorial(result.tutorialId) && typeof result.completed === "boolean" ? result : null;
  } catch { return null; }
}

export function readTutorialProgress(): Record<string, boolean> {
  try {
    const progress = JSON.parse(window.localStorage.getItem(FEATURE_TUTORIAL_PROGRESS_KEY) || "{}");
    return progress && typeof progress === "object" && !Array.isArray(progress) ? progress : {};
  } catch { return {}; }
}
