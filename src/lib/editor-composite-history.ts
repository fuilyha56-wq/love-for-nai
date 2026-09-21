type CompositeHistoryInput = {
  image: string;
  model: string;
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps: number;
  scale: number;
  sampler: string;
  strength: number;
  seed?: number;
};

/** Persist the final full-sized composite, never the generated ROI patch. */
export async function saveEditorComposite(input: CompositeHistoryInput): Promise<string> {
  const response = await fetch("/api/history/editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => ({})) as { id?: unknown; message?: string };
  if (!response.ok || typeof result.id !== "string" || !result.id)
    throw new Error(result.message || "完整合成图未写入历史");
  return result.id;
}
