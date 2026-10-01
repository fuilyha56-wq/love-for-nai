import { resolvedNewApiBaseUrl, userHeaders, type Session } from "@/lib/newapi";
import { isKnownImageModel } from "@/lib/image-model-capabilities";

export type AvailableModel = { id: string; kind: "图像模型" | "助手模型" };

const MODEL_ID = /^[^\u0000-\u001f\u007f]{1,160}$/;

function inspect(value: unknown, into: Map<string, boolean>): void {
  if (typeof value === "string") {
    const id = value.trim();
    if (MODEL_ID.test(id)) into.set(id, into.get(id) || isKnownImageModel(id));
    return;
  }
  if (Array.isArray(value)) { value.forEach((item) => inspect(item, into)); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const nested of [record.data, record.items, record.models]) if (nested) inspect(nested, into);
  const id = [record.id, record.model, record.model_name, record.name].find((item) => typeof item === "string") as string | undefined;
  if (!id || !MODEL_ID.test(id.trim())) return;
  const metadata = [record.kind, record.type, record.category, record.capabilities, record.modalities, record.supported_endpoint_types]
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .filter((item): item is string => typeof item === "string")
    .join(" ").toLowerCase();
  const image = /(?:image|图像|绘图|图片|\/v1\/images|draw)/.test(metadata) || isKnownImageModel(id);
  into.set(id.trim(), Boolean(into.get(id.trim()) || image));
}

export async function loadNewApiModels(session: Session): Promise<AvailableModel[]> {
  const base = await resolvedNewApiBaseUrl();
  const headers = userHeaders(session);
  const response = await fetch(`${base}/api/user/models`, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const payload = await response.json() as { success?: boolean; message?: string; data?: unknown };
  if (!response.ok || payload.success === false) throw new Error(payload.message || "无法读取可用模型");
  const models = new Map<string, boolean>();
  inspect(payload.data ?? payload, models);
  // NewAPI pricing provides the actual Draw-channel grouping when /api/user/models only lists IDs.
  try {
    const pricing = await fetch(`${base}/api/pricing`, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (pricing.ok) {
      const result = await pricing.json() as { data?: Array<{ model_name?: string; enable_groups?: string[] }> };
      for (const entry of result.data ?? []) {
        if (entry.model_name && models.has(entry.model_name) && entry.enable_groups?.some((group) => group.toLowerCase() === "draw"))
          models.set(entry.model_name, true);
      }
    }
  } catch { /* model names remain available without optional pricing metadata */ }
  return [...models].map(([id, image]) => ({ id, kind: image ? "图像模型" as const : "助手模型" as const }))
    .sort((a,b) => a.id.localeCompare(b.id));
}

export async function userCanGenerateWithNewApiModel(session: Session, model: string): Promise<boolean> {
  return (await loadNewApiModels(session)).some((item) => item.id === model && item.kind === "图像模型");
}
