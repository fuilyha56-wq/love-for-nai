import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { resolvedNewApiBaseUrl, userHeaders } from "@/lib/newapi";
import { listStoryProviders } from "@/lib/story-providers";

type PricingModel = { model_name?: string; enable_groups?: string[] };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const providers = await listStoryProviders(session.userId);
  let newApi: Array<{ id: string; label: string; source: string }> = [];
  let warning: string | undefined;
  try {
    const base = await resolvedNewApiBaseUrl();
    const headers = userHeaders(session);
    const [modelsResponse, pricingResponse] = await Promise.all([
      fetch(`${base}/api/user/models`, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) }),
      fetch(`${base}/api/pricing`, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) }),
    ]);
    if (!modelsResponse.ok || !pricingResponse.ok) throw new Error("暂时无法读取 NewAPI 模型");
    const models = await modelsResponse.json() as { data?: unknown; success?: boolean };
    const pricing = await pricingResponse.json() as { data?: PricingModel[] };
    if (models.success === false || !Array.isArray(pricing.data)) throw new Error("暂时无法读取 NewAPI 模型");
    const available = new Set<string>();
    function collect(value: unknown) {
      if (typeof value === "string") available.add(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (typeof record.id === "string") available.add(record.id);
        if (typeof record.model === "string") available.add(record.model);
        for (const key of ["items", "models", "data"]) if (key in record) collect(record[key]);
      }
    }
    collect(models.data);
    newApi = pricing.data.filter((item) => typeof item.model_name === "string" && available.has(item.model_name) &&
      item.enable_groups?.some((group) => group.toLowerCase() === "ikun") &&
      (!item.model_name.toLowerCase().startsWith("nai-") || item.model_name === "nai-chat" || item.model_name.startsWith("nai-chat-")))
      .map((item) => ({ id: `newapi:${item.model_name}`, label: item.model_name!, source: "NewAPI · ikun" }));
  } catch (error) { warning = error instanceof Error ? error.message : "无法读取 NewAPI 模型"; }
  return NextResponse.json({
    items: [...newApi, ...providers.map((item) => ({ id: `custom:${item.id}`, label: item.name, source: item.kind === "novelai" ? "NovelAI Key" : "自定义 API" }))],
    warning,
  });
}