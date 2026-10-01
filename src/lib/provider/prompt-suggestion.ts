import { NextResponse } from "next/server";
import { checkImageRateLimit } from "@/lib/image-request";
import { getChatToken, resolvedNewApiBaseUrl } from "@/lib/newapi";
import { isImageProviderProtocol, isKnownImageModel } from "@/lib/image-model-capabilities";
import { runImagePromptSuggestion } from "@/lib/image-prompt-suggestion";
import { inlineRaster } from "@/lib/image-transport";
import type { LfnSession } from "@/lib/session";
import { validateModelId } from "./validation";

export async function handleNaturalImagePromptSuggestion(request: Request, session: LfnSession, body: Record<string, unknown>): Promise<NextResponse> {
  const rate = checkImageRateLimit(request, `session:${session.userId}`);
  if (!rate.allowed) return NextResponse.json({ message: "提示词建议请求过于频繁，请稍后重试" }, { status: 429 });
  let chatModel: string;
  let imageModel: string;
  let images: string[];
  try {
    chatModel = validateModelId(body.assistantModel);
    imageModel = validateModelId(body.model);
    if (isKnownImageModel(chatModel)) throw new Error("请选择文本或视觉助手模型，图像模型不能代替聊天模型");
    if (body.imageProtocol !== undefined && !isImageProviderProtocol(body.imageProtocol)) throw new Error("图像 API 协议无效");
    if (typeof body.prompt !== "string" || body.prompt.length > 10_000) throw new Error("提示词需在 10000 字以内");
    images = (Array.isArray(body.images) ? body.images : typeof body.image === "string" && body.image ? [body.image] : []) as string[];
    if (images.length > 4) throw new Error("最多使用 4 张提示词建议参考图");
    images = images.map((image) => { const raster = inlineRaster(image); return `data:${raster.mime};base64,${raster.data}`; });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "提示词建议参数无效" }, { status: 400 }); }
  try {
    const key = await getChatToken(session, chatModel);
    const baseUrl = await resolvedNewApiBaseUrl();
    return NextResponse.json(await runImagePromptSuggestion({ key, chatModel, baseUrl, imageModel, modelProtocol: isImageProviderProtocol(body.imageProtocol) ? body.imageProtocol : "auto", prompt: body.prompt as string, images, signal: request.signal }));
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "提示词建议失败" }, { status: 502 }); }
}
