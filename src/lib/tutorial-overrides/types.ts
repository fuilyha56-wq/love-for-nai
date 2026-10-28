import type { TutorialStep } from "../feature-tutorials";

export type TutorialOverride = {
  preparation?: string;
  summary?: string;
  steps?: Record<number, Partial<TutorialStep>>;
};
