import type { FeatureTutorial } from "../feature-tutorials";
import { tutorialOverride as tutorial0 } from "./text-to-image";
import { tutorialOverride as tutorial1 } from "./prompt-writing";
import { tutorialOverride as tutorial2 } from "./image-to-image";
import { tutorialOverride as tutorial3 } from "./inpaint";
import { tutorialOverride as tutorial4 } from "./outpaint";
import { tutorialOverride as tutorial5 } from "./upscale";
import { tutorialOverride as tutorial6 } from "./tiled-upscale";
import { tutorialOverride as tutorial7 } from "./characters";
import { tutorialOverride as tutorial8 } from "./vibe";
import { tutorialOverride as tutorial9 } from "./precise-reference";
import { tutorialOverride as tutorial10 } from "./director";
import { tutorialOverride as tutorial11 } from "./tag-assistant";
import { tutorialOverride as tutorial12 } from "./tag-library";
import { tutorialOverride as tutorial13 } from "./history";
import { tutorialOverride as tutorial14 } from "./gallery";
import { tutorialOverride as tutorial15 } from "./gallery-submit";
import { tutorialOverride as tutorial16 } from "./stories";
import { tutorialOverride as tutorial17 } from "./layout";
import { tutorialOverride as tutorial18 } from "./providers";
import { tutorialOverride as tutorial19 } from "./wallet";
import { tutorialOverride as tutorial20 } from "./api-access";

const overrides = {
  "text-to-image": tutorial0,
  "prompt-writing": tutorial1,
  "image-to-image": tutorial2,
  "inpaint": tutorial3,
  "outpaint": tutorial4,
  "upscale": tutorial5,
  "tiled-upscale": tutorial6,
  "characters": tutorial7,
  "vibe": tutorial8,
  "precise-reference": tutorial9,
  "director": tutorial10,
  "tag-assistant": tutorial11,
  "tag-library": tutorial12,
  "history": tutorial13,
  "gallery": tutorial14,
  "gallery-submit": tutorial15,
  "stories": tutorial16,
  "layout": tutorial17,
  "providers": tutorial18,
  "wallet": tutorial19,
  "api-access": tutorial20,
};

export function applyTutorialOverride(tutorial: FeatureTutorial): FeatureTutorial {
  const override = overrides[tutorial.id as keyof typeof overrides];
  if (!override) return tutorial;
  return { ...tutorial, ...override, steps: tutorial.steps.map((step, index) => ({ ...step, ...override.steps?.[index] })) };
}
