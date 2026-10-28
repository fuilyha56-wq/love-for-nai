/** Preserve NovelAI's signed numeric emphasis when editing or toggling a tag. */
export function renderPromptWeight(base: string, depth: number, numericWeight: number | null, disabled: boolean): string {
  let text = base;
  if (numericWeight != null && Number.isFinite(numericWeight)) {
    text = numericWeight === 1 ? base : `${numericWeight}::${base}::`;
  } else if (depth > 0) {
    text = "{".repeat(depth) + base + "}".repeat(depth);
  } else if (depth < 0) {
    text = "[".repeat(-depth) + base + "]".repeat(-depth);
  }
  return disabled ? `/*disabled:${text.replaceAll("\\", "\\\\").replaceAll("*/", "*\\/")}*/` : text;
}

/** Numeric controls move by 0.05, independently of bracket depth controls. */
export function stepPromptWeight(weight: number, direction: number): number {
  return Number((weight + direction * 0.05).toPrecision(15));
}
