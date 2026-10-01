import { NextResponse } from "next/server";
import { splitImageBatches } from "@/lib/image-batches";
import { saveHistory } from "@/lib/history";
import { checkImageRateLimit, ImageRequestValidationError, normalizeSamples } from "@/lib/image-request";
import { resolveImageModelCapabilities, type ImageProviderProtocol } from "@/lib/image-model-capabilities";
import { buildImageTransportRequest, finishImageTransportImages, imageTransportOutputDimensions, parseImageTransportResult, type ImageTransportRequest } from "@/lib/image-transport";
import { ModelConcurrencyQueueAbortError } from "@/lib/model-concurrency";
import type { LfnSession } from "@/lib/session";
import { ProviderInputError, validateModelId } from "./validation";
import { downloadProviderImage } from "./http";

type ProviderImageOptions = {
  protocol: ImageProviderProtocol;
  apiKey: string;
  paymentSource: "personal-key" | "newapi";
  send: (upstream: ImageTransportRequest) => Promise<Response>;
  rateChecked?: boolean;
  saveToHistory?: boolean;
};

/** Shared transport loop keeps batching, partial results and history identical across image families. */
export async function handleImageModelGeneration(request: Request, session: LfnSession, body: Record<string, unknown>, options: ProviderImageOptions): Promise<NextResponse> {
  if (!options.rateChecked) {
    const rate = checkImageRateLimit(request, `session:${session.userId}`);
    if (!rate.allowed) return NextResponse.json({ message: "图像请求过于频繁，请稍后重试" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  let samples: number;
  let model: string;
  let firstRequest: ImageTransportRequest;
  try {
    model = validateModelId(body.model);
    samples = normalizeSamples(body);
    const capabilities = resolveImageModelCapabilities(model, options.protocol);
    firstRequest = await buildImageTransportRequest({ ...body, model }, options.apiKey, options.protocol, Math.min(samples, capabilities.maxBatch));
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "图像参数无效" }, { status: 400 });
  }
  const requestBody = { ...body, model, width: firstRequest.width, height: firstRequest.height };
  const normalized = { ...requestBody };
  const images: string[] = [];
  let usage: unknown = null;
  let upstreamText = "";
  let warning = "";
  const save = options.saveToHistory !== false && body.editor_composite !== true;
  const partial = async (message: string, status: number): Promise<NextResponse> => {
    let historyIds: string[] = [];
    if (images.length && save) {
      try { historyIds = (await saveHistory(session.userId, normalized, images, usage)).map((item) => item.id); }
      catch { /* generated output remains available if history storage fails */ }
    }
    return NextResponse.json({ message: images.length ? `已生成 ${images.length}/${samples} 张后中断：${message}` : message, ...(images.length ? { images, image: images[0], historyIds, partial: true, usage, width: normalized.width, height: normalized.height, paymentSource: options.paymentSource, ...(warning ? { warning } : {}) } : {}) }, { status: images.length ? 207 : status, headers: { "X-LFN-Payment-Source": options.paymentSource } });
  };
  try {
    const batches = splitImageBatches(samples, resolveImageModelCapabilities(model, options.protocol).maxBatch);
    for (let index = 0; index < batches.length; index++) {
      if (request.signal.aborted) return partial("生成已取消", 499);
      const nextBody = { ...requestBody, ...(resolveImageModelCapabilities(model, options.protocol).seed && typeof body.seed === "number" ? { seed: (body.seed + images.length) % 2 ** 32 } : {}) };
      const upstreamRequest = index === 0 ? firstRequest : await buildImageTransportRequest(nextBody, options.apiKey, options.protocol, batches[index]);
      const response = await options.send(upstreamRequest);
      const raw = await response.text();
      if (raw.length > 70_000_000) return partial("上游图像响应超过大小限制", 502);
      let result: Record<string, unknown>;
      try { result = JSON.parse(raw) as Record<string, unknown>; }
      catch { return partial(`上游返回了非 JSON 响应（${response.status}）`, 502); }
      const upstreamError = result.error && typeof result.error === "object" ? result.error as Record<string, unknown> : {};
      if (!response.ok || result.error || result.detail) {
        const message = [upstreamError.message, result.message, result.detail].find((value) => typeof value === "string") as string | undefined;
        return partial(message || `上游图像请求失败（${response.status}）`, response.ok ? 502 : response.status);
      }
      const parsed = parseImageTransportResult(result);
      if (!parsed.images.length) return partial(parsed.text ? `上游未返回图片：${parsed.text.slice(0, 300)}` : "上游未返回图片；请确认当前模型支持所选图像协议", 502);
      const inlineImages: string[] = [];
      for (const image of parsed.images.slice(0, batches[index])) {
        if (image.startsWith("data:")) inlineImages.push(image);
        else {
          try { inlineImages.push(await downloadProviderImage(image, request.signal)); }
          catch (error) {
            if (typeof body.mask === "string" && body.mask || body.operation === "upscale") throw error;
            inlineImages.push(image);
            warning = "图片已生成，但无法取回图片文件；当前可查看上游链接，暂不能保存或再次编辑";
          }
        }
      }
      const finished = await finishImageTransportImages(normalized, inlineImages);
      const outputDimensions = await imageTransportOutputDimensions(finished[0]);
      if (outputDimensions) { normalized.width = outputDimensions.width; normalized.height = outputDimensions.height; }
      images.push(...finished);
      usage = parsed.usage ?? usage;
      upstreamText = parsed.text || upstreamText;
      if (parsed.images.length < batches[index]) return partial("上游返回的图片数量少于请求数量", 502);
    }
    let historyIds: string[] = [];
    if (save) {
      try { historyIds = (await saveHistory(session.userId, normalized, images, usage)).map((item) => item.id); }
      catch { warning = "图片已生成，但暂时无法保存历史记录"; }
    }
    return NextResponse.json({ images, image: images[0], historyIds, usage, width: normalized.width, height: normalized.height, ...(upstreamText ? { text: upstreamText } : {}), ...(warning ? { warning } : {}), ...(body.operation === "upscale" ? { method: "generative-edit" } : {}), payment: options.paymentSource, paymentSource: options.paymentSource, aff: null }, { headers: { "X-LFN-Payment-Source": options.paymentSource } });
  } catch (error) {
    const invalid = error instanceof ImageRequestValidationError || error instanceof ProviderInputError;
    const queueAborted = error instanceof ModelConcurrencyQueueAbortError;
    return partial(error instanceof Error ? error.message : "图像请求失败", invalid ? 400 : queueAborted ? 503 : 502);
  }
}
