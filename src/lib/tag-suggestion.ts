export type SuggestedCharacter = {
  prompt: string;
  centerX: number;
  centerY: number;
};

export type TagSuggestion = {
  prompt: string;
  negativePrompt: string;
  tags: string[];
  characters?: SuggestedCharacter[];
  parameters: {
    width?: number;
    height?: number;
    steps?: number;
    scale?: number;
    sampler?: string;
    noiseSchedule?: string;
    seed?: number;
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function limitedString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

// 多角色建议解析：prompt 必填，center 缺省 0.5，坐标钳位到 0–1。
function parseCharacters(value: unknown): SuggestedCharacter[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const characters = value
    .map((item) => {
      const raw = record(item);
      const prompt = limitedString(raw.prompt, 2_000).trim();
      if (!prompt) return null;
      const clamp01 = (coordinate: unknown) => {
        const number = finiteNumber(coordinate);
        return number == null ? 0.5 : Math.min(1, Math.max(0, number));
      };
      const rawCenter = record(raw.center);
      const centerList = Array.isArray(rawCenter.centers)
        ? rawCenter.centers
        : null;
      const center = centerList ? record(centerList[0]) : rawCenter;
      return {
        prompt,
        centerX: clamp01(center.x),
        centerY: clamp01(center.y),
      };
    })
    .filter((item): item is SuggestedCharacter => item !== null)
    .slice(0, 6);
  return characters.length ? characters : undefined;
}

export function parseTagSuggestion(content: string): TagSuggestion {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("模型未返回可读取的建议");

  let raw: Record<string, unknown>;
  try {
    raw = record(JSON.parse(match[0]));
  } catch {
    throw new Error("模型返回的建议不是合法 JSON");
  }
  const rawParameters = record(raw.parameters);
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 24)
    : [];

  // NAI 约定 seed 0 = 随机；模型经常显式回 seed:0，
  // 归一为未提供，避免把种子框填成 0。
  const rawSeed = finiteNumber(rawParameters.seed);

  return {
    prompt: limitedString(raw.prompt, 10_000),
    negativePrompt: limitedString(raw.negativePrompt, 10_000),
    tags,
    characters: parseCharacters(raw.characters ?? raw.characterPrompts),
    parameters: {
      width: finiteNumber(rawParameters.width),
      height: finiteNumber(rawParameters.height),
      steps: finiteNumber(rawParameters.steps),
      scale: finiteNumber(rawParameters.scale),
      sampler: limitedString(rawParameters.sampler, 80) || undefined,
      noiseSchedule:
        limitedString(rawParameters.noiseSchedule, 80) || undefined,
      seed: rawSeed != null && rawSeed > 0 ? rawSeed : undefined,
    },
  };
}
