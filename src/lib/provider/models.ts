import { rememberDiscoveredModels, type CustomProvider } from "./store";
import { safeProviderFetch } from "./http";
import { validateModelId } from "./validation";
import { isKnownImageModel, resolveProviderImageProtocol } from "@/lib/image-model-capabilities";

export async function discoverProviderModels(provider: CustomProvider): Promise<string[]> {
  const gemini = resolveProviderImageProtocol(provider.protocol, provider.baseUrl) === "gemini";
  const response = await safeProviderFetch(provider.baseUrl, gemini ? "/v1beta/models?pageSize=1000" : "/v1/models", {
    headers: gemini ? { "x-goog-api-key": provider.apiKey } : { Authorization: `Bearer ${provider.apiKey}` },
  });
  if (!response.ok) throw new Error(`第三方 API 模型读取失败（${response.status}）`);
  const result = await response.json() as { data?: unknown; models?: unknown };
  const data = Array.isArray(result.data) ? result.data : Array.isArray(result.models) ? result.models : [];
  const models: string[] = [];
  for (const item of data.slice(0, 500)) {
    const id = item && typeof item === "object" ? ((item as Record<string, unknown>).id ?? (item as Record<string, unknown>).name) : item;
    const metadata = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const indicators = [metadata.type, metadata.kind, metadata.category, metadata.capabilities, metadata.modalities, metadata.supported_endpoint_types]
      .flatMap((part) => Array.isArray(part) ? part : [part])
      .filter((part): part is string => typeof part === "string")
      .join(" ").toLowerCase();
    try {
      const model = validateModelId(typeof id === "string" ? id.replace(/^models\//, "") : id);
      // Imagen uses a different predict API; don't advertise it as a Gemini generateContent model.
      if (gemini && !/^gemini-.*image/i.test(model)) continue;
      if (/(?:image|图像|图片|绘图|draw|\/v1\/images)/.test(indicators) || isKnownImageModel(model))
        models.push(model);
    } catch { /* ignore malformed upstream records */ }
  }
  return [...new Set(models)].sort((a,b) => a.localeCompare(b));
}

export async function providerAllowsModel(userId: number, provider: CustomProvider, model: string): Promise<boolean> {
  if (provider.models.includes(model) || provider.discoveredModels?.includes(model)) return true;
  try {
    const discovered = await discoverProviderModels(provider);
    if (!discovered.includes(model)) return false;
    await rememberDiscoveredModels(userId, provider.id, discovered).catch(() => undefined);
    return true;
  } catch { return false; }
}
