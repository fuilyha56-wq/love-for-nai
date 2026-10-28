import type { Session } from "@/lib/newapi";
import { getChatToken, refreshChatToken, resolvedNewApiBaseUrl } from "@/lib/newapi";
import { assistantModelIds } from "@/lib/assistant-models";
import { loadNewApiModels } from "@/lib/provider/newapi-models";
import { resolveTextProviderModel } from "@/lib/provider/store";
import { safeProviderFetch } from "@/lib/provider/http";
import { validateModelId } from "@/lib/provider/validation";
import type { AssistantKeyAuth } from "@/lib/assistant-model-request";

export class AssistantSourceError extends Error {}
export type AssistantSource = AssistantKeyAuth & { baseUrl: string; external?: boolean };

/** Resolve only this user's saved registry. Browser input never supplies an endpoint or secret. */
export async function resolveAssistantSource(session: Session, model: string, providerId?: unknown, group?: unknown): Promise<AssistantSource> {
  validateModelId(model);
  if (providerId !== undefined && (typeof providerId !== "string" || !providerId || providerId.length > 100)) throw new AssistantSourceError("助手模型来源无效");
  if (group !== undefined && (typeof group !== "string" || group.length > 128 || /[\u0000-\u001f\u007f]/.test(group))) throw new AssistantSourceError("助手模型分组无效");
  if (providerId && providerId !== "newapi") {
    const resolved = await resolveTextProviderModel(session.userId, providerId as string, model);
    if (!resolved || resolved.kind && resolved.kind !== "openai") throw new AssistantSourceError("自定义文本模型已移除或不可访问，请刷新模型列表");
    const { provider } = resolved;
    return {
      key: provider.apiKey, baseUrl: provider.baseUrl, external: true,
      transport: (init) => safeProviderFetch(provider.baseUrl, "/v1/chat/completions", {
        method: "POST", headers: Object.fromEntries(new Headers(init.headers)), body: init.body as string,
        signal: init.signal ?? undefined, timeoutMs: 180_000,
      }),
    };
  }
  if (!assistantModelIds(await loadNewApiModels(session)).includes(model)) throw new AssistantSourceError("该模型不是当前 NewAPI 账号可用的对话模型，请刷新模型列表");
  const selectedGroup = typeof group === "string" && group ? group : undefined;
  return { key: await getChatToken(session, model, ...selectedGroup ? [selectedGroup] : []), baseUrl: await resolvedNewApiBaseUrl(),
    refreshKey: (key) => refreshChatToken(session, model, key, ...selectedGroup ? [selectedGroup] : []) };
}
