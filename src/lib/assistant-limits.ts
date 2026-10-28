export const MAX_ASSISTANT_IMAGES = 10;
export const MAX_ASSISTANT_IMAGE_BYTES = 8_000_000;
export const MAX_ASSISTANT_TOTAL_IMAGE_BYTES = 24_000_000;
export const ASSISTANT_HISTORY_CHAR_BUDGET = 24_000;
export const DEFAULT_GOAL_GENERATIONS = 5;
export const MAX_GOAL_GENERATIONS = 100;

export function validGoalGenerations(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_GOAL_GENERATIONS;
}

/** Keep complete turn pairs, newest first for selection, chronological for sending. */
export function boundedAssistantHistory<T extends { request: string; answer: string }>(history: T[]) {
  let remaining = ASSISTANT_HISTORY_CHAR_BUDGET;
  const selected: T[] = [];
  for (const turn of [...history].reverse()) {
    if (typeof turn.request !== "string" || typeof turn.answer !== "string" || !turn.request || !turn.answer) continue;
    const cost = turn.request.length + turn.answer.length;
    if (cost > remaining) break;
    selected.unshift(turn); remaining -= cost;
  }
  return selected;
}
