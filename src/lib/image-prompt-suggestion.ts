import { isKnownImageModel, type ImageProviderProtocol } from "@/lib/image-model-capabilities";
import { adaptAssistantSuggestion, resolveAssistantImageTarget } from "@/lib/assistant-model-prompts";
import { runTagAgent } from "@/lib/tag-agent";
import { parseTagSuggestion } from "@/lib/tag-suggestion";

/** Called after route-owned session, model permission and upstream selection checks. */
export async function runImagePromptSuggestion(options: {
  key: string;
  chatModel: string;
  baseUrl?: string;
  imageModel: string;
  modelProtocol?: ImageProviderProtocol;
  prompt: string;
  images?: string[];
  signal?: AbortSignal;
}) {
  const target = resolveAssistantImageTarget({ imageModel: options.imageModel, modelProtocol: options.modelProtocol });
  if (target.capabilities.promptStyle !== "natural") throw new Error("此提示词建议入口仅适用于自然语言图像模型");
  if (!options.chatModel.trim() || options.chatModel.length > 160 || /[\u0000-\u001f\u007f]/.test(options.chatModel) || isKnownImageModel(options.chatModel))
    throw new Error("请选择一个文本或视觉助手模型");
  if (typeof options.prompt !== "string" || options.prompt.length > 10_000)
    throw new Error("提示词需在 10000 字以内");
  const images = options.images ?? [];
  if (images.length > 4 || images.some((image) => image.length > 8_000_000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)))
    throw new Error("参考图片必须为最多 4 张 PNG、JPEG 或 WebP data URL");
  if (!options.prompt.trim() && !images.length) throw new Error("请输入需要补写的提示词或提供参考图片");
  const result = await runTagAgent(
    options.key,
    options.chatModel,
    images.length
      ? "根据参考图片及现有提示词，给出适用于当前图像模型的完整自然语言描述。保留用户已有意图和指定文字。仅生成可应用的提示词，不生成图片，不进行网络检索。"
      : "完善并补写现有提示词，保持原意，补充清晰的场景、构图及视觉细节，返回可以直接替换原文的完整自然语言提示词。仅生成提示词，不生成图片，不进行网络检索。",
    { currentPrompt: options.prompt, imageModel: target.imageModel, modelProtocol: target.modelProtocol, operation: "generate" },
    1,
    { images, baseUrl: options.baseUrl, signal: options.signal },
  );
  const suggestion = adaptAssistantSuggestion(parseTagSuggestion(result.content), target);
  if (!suggestion.prompt.trim()) throw new Error("助手未返回可使用的提示词");
  return {
    prompt: suggestion.prompt,
    text: suggestion.prompt,
    description: suggestion.englishDescription,
    message: suggestion.message,
    parameters: suggestion.parameters,
    tags: [] as string[],
    imageModel: target.imageModel,
    promptStyle: "natural" as const,
  };
}
