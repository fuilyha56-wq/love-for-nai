import type { CustomProvider } from "./store";
import { safeProviderFetch } from "./http";
import { validateModelId } from "./validation";

export async function discoverProviderModels(provider: CustomProvider): Promise<string[]> {
  const response = await safeProviderFetch(provider.baseUrl, "/v1/models", {
    headers: { Authorization: `Bearer ${provider.apiKey}` },
  });
  if (!response.ok) throw new Error(`第三方 API 模型读取失败（${response.status}）`);
  const result = await response.json() as { data?: unknown };
  const data = Array.isArray(result.data) ? result.data : [];
  const models: string[] = [];
  for (const item of data.slice(0, 500)) {
    const id = item && typeof item === "object" ? (item as Record<string, unknown>).id : item;
    const metadata = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const indicators = [metadata.type, metadata.kind, metadata.category, metadata.capabilities, metadata.modalities, metadata.supported_endpoint_types]
      .flatMap((part) => Array.isArray(part) ? part : [part])
      .filter((part): part is string => typeof part === "string")
      .join(" ").toLowerCase();
    try {
      const model = validateModelId(id);
      if (/(?:image|图像|图片|绘图|draw|\/v1\/images)/.test(indicators) || /^(?:nai-(?!chat$)|gpt-image|dall-e|flux(?:\.|-|$)|stable-diffusion|sdxl|imagen|ideogram|recraft|midjourney|seedream|sd3(?:\.|-|$))/i.test(model))
        models.push(model);
    } catch { /* ignore malformed upstream records */ }
  }
  return [...new Set(models)].sort((a,b) => a.localeCompare(b));
}

export async function providerAllowsModel(provider: CustomProvider, model: string): Promise<boolean> {
  if (provider.models.includes(model)) return true;
  try { return (await discoverProviderModels(provider)).includes(model); }
  catch { return false; }
}
