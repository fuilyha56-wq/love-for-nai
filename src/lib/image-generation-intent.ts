export type ImageGenerationIntent = {
  prompt: string;
  negativePrompt?: string;
  operation?: string;
  model?: string;
  providerId?: string;
  count?: number; width?: number;
  height?: number;
  steps?: number;
  scale?: number;
  seed?: string | number;
  sampler?: string;
  origin?: "story" | "comic";
  projectId?: string;
  panelId?: string;
};

export function parseImageGenerationIntent(value: unknown): ImageGenerationIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("生成任务快照格式无效");
  const item = value as Record<string, unknown>;
  if (typeof item.prompt !== "string") throw new Error("生成任务缺少提示词");
  const intent: ImageGenerationIntent = { prompt: item.prompt };
  for (const key of ["negativePrompt", "operation", "model", "providerId", "sampler", "projectId", "panelId"] as const) {
    if (item[key] !== undefined) {
      if (typeof item[key] !== "string") throw new Error("生成任务文本字段格式无效");
      intent[key] = item[key] as string;
    }
  }
  if (item.origin === "story" || item.origin === "comic") intent.origin = item.origin;
  for (const key of ["width", "height", "steps", "scale", "count"] as const) {
    if (item[key] !== undefined) {
      if (typeof item[key] !== "number" || !Number.isFinite(item[key])) throw new Error("生成任务参数格式无效");
      intent[key] = item[key] as number;
    }
  }
  if (typeof item.seed === "string" || (typeof item.seed === "number" && Number.isFinite(item.seed))) intent.seed = item.seed;
  if (intent.prompt.length > 40_000 || (intent.negativePrompt?.length || 0) > 40_000) throw new Error("生成提示词不能超过 40000 字");
  return intent;
}

/** Explicitly opt into studio hydration; arbitrary page links never overwrite a draft. */
export function imageGenerationIntentUrl(intent: ImageGenerationIntent): string {
  if (intent.prompt.length > 40_000 || (intent.negativePrompt?.length || 0) > 40_000) throw new Error("生成提示词不能超过 40000 字");
  const params = new URLSearchParams({ reuse: "1", prompt: intent.prompt });
  if (intent.negativePrompt !== undefined) params.set("negative_prompt", intent.negativePrompt);
  for (const key of ["operation", "model", "providerId", "sampler", "origin", "projectId", "panelId"] as const) {
    if (intent[key] !== undefined) params.set(key, String(intent[key]));
  }
  for (const key of ["width", "height", "steps", "scale", "seed"] as const) {
    const value = intent[key];
    if (value !== undefined && (typeof value !== "number" || Number.isFinite(value))) params.set(key, String(value));
  }
  return `/image?${params}`;
}
