import { isKnownImageModel } from "@/lib/image-model-capabilities";

/** Vision input is supported; image generation and non-chat endpoints are not. */
export function isAssistantChatModel(id: string): boolean {
  const model = id.trim().replace(/^(?:\[[^\]]+\]\s*)+/, "");
  return Boolean(model) && !isKnownImageModel(id) &&
    !/(?:embedding|rerank|whisper|(?:^|[-_.])tts(?:$|[-_.])|text-to-speech|text-to-video|sora(?:$|[-_.])|veo(?:$|[-_.]))/i.test(model) &&
    !/^(?:baai\/)?bge(?:[-_.:]|$)/i.test(model);
}

export function assistantModelIds(items: Array<{ id: string; kind: string }>): string[] {
  return items.filter((item) => item.kind === "助手模型" && isAssistantChatModel(item.id)).map((item) => item.id);
}
