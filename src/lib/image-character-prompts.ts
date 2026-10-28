/** Text-only character prompts shared by history, gallery and the studio. */
export type ImageCharacterPrompt = {
  prompt: string;
  negativePrompt: string;
  center: { x: number; y: number };
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(...values: unknown[]): string {
  return (values.find(value => typeof value === "string") as string | undefined) || "";
}
function coordinate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : .5;
}
function captions(value: unknown): unknown[] {
  const caption = record(record(value).caption);
  return Array.isArray(caption.char_captions) ? caption.char_captions : [];
}

export function hasImageCharacterPrompts(parameters: Record<string, unknown>): boolean {
  return Array.isArray(parameters.characterPrompts) || Array.isArray(parameters.characters) ||
    Array.isArray(record(record(parameters.v4_prompt).caption).char_captions) ||
    Array.isArray(record(record(parameters.v4_negative_prompt).caption).char_captions);
}

export function readImageCharacterPrompts(parameters: Record<string, unknown>): ImageCharacterPrompt[] {
  const positive = captions(parameters.v4_prompt);
  const negative = captions(parameters.v4_negative_prompt);
  const direct = Array.isArray(parameters.characterPrompts) ? parameters.characterPrompts
    : Array.isArray(parameters.characters) ? parameters.characters : null;
  return Array.from({ length: Math.min(6, direct?.length ?? Math.max(positive.length, negative.length)) }, (_, index) => {
    const item = record(direct ? direct[index] : positive[index]);
    const positiveItem = record(positive[index]);
    const negativeItem = record(negative[index]);
    const center = record(item.center ?? (Array.isArray(item.centers) ? item.centers[0] : undefined) ??
      (Array.isArray(positiveItem.centers) ? positiveItem.centers[0] : undefined));
    return {
      prompt: text(item.prompt, item.char_caption, positiveItem.char_caption).slice(0, 4_000),
      negativePrompt: text(item.negativePrompt, item.negative, negativeItem.char_caption).slice(0, 4_000),
      center: { x: coordinate(center.x ?? item.centerX), y: coordinate(center.y ?? item.centerY) },
    };
  }).filter(item => item.prompt.trim() || item.negativePrompt.trim());
}

export function imagePromptText(parameters: Record<string, unknown>) {
  return {
    prompt: text(parameters.prompt, parameters.input, record(record(parameters.v4_prompt).caption).base_caption).slice(0, 20_000),
    negativePrompt: text(parameters.negative_prompt, parameters.uc, parameters.negativePrompt,
      record(record(parameters.v4_negative_prompt).caption).base_caption).slice(0, 20_000),
  };
}

export function imageCharacterUseCoords(parameters: Record<string, unknown>): boolean | undefined {
  const value = parameters.use_coords ?? record(parameters.v4_prompt).use_coords;
  return typeof value === "boolean" ? value : undefined;
}

/** Recover missing character text from old images without overriding saved settings. */
export function restoreImageCharacterPrompts(parameters: Record<string, unknown>, embedded: Record<string, unknown>) {
  if (hasImageCharacterPrompts(parameters)) return parameters;
  const characterPrompts = readImageCharacterPrompts(embedded);
  if (!characterPrompts.length) return parameters;
  return { ...parameters, characterPrompts, use_coords: imageCharacterUseCoords(parameters) ?? imageCharacterUseCoords(embedded) };
}
