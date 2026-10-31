import { NextResponse } from "next/server";
import { imagePricingStrength } from "@/lib/image-pricing";
import { splitImageBatches, MAX_IMAGE_REQUEST_SAMPLES } from "@/lib/image-batches";
import { saveHistory } from "@/lib/history";
import { watermarkImages } from "@/lib/image-watermark";
import { startRequestAudit } from "@/lib/request-audit";
import { isNaiModelEnabled } from "@/lib/runtime-config";
import { checkImageRateLimit, normalizeDimension, normalizeSamples, normalizeSteps, validateImageShape, validateNaiGenerationCost, assertImageModel } from "@/lib/image-request";
import { naiNativeGenerationBody } from "@/lib/nai-native-request";
import type { LfnSession } from "@/lib/session";
import { safeProviderFetch } from "./http";
import { providerAllowsModel } from "./models";
import { generateNovelaiImage } from "./novelai";
import { getNovelaiKey, getProvider } from "./store";
import { validateModelId } from "./validation";
import { resolveProviderImageProtocol } from "@/lib/image-model-capabilities";
import { withModelConcurrencySlot } from "@/lib/model-concurrency";
import { handleImageModelGeneration } from "./image-generation";
import { IMAGE_UPSTREAM_TIMEOUT_MS } from "@/lib/image-timeouts";
import { safeUpstreamMessage } from "@/lib/upstream-error";

const nativeOperations = new Set(["generate", "img2img", "inpainting", "edits", "outpainting", "vibe-transfer", "character-reference", "precise-reference"]);

export async function handlePersonalProviderGeneration(request: Request, session: LfnSession, body: Record<string, unknown>, providerId: string): Promise<NextResponse> {
  const rate = checkImageRateLimit(request, `session:${session.userId}`);
  if (!rate.allowed) return NextResponse.json({ message: "图像请求过于频繁，请稍后重试" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  if (providerId !== "novelai") {
    const provider = await getProvider(session.userId, providerId);
    if (!provider) return NextResponse.json({ message: "找不到该第三方 API 配置" }, { status: 404 });
    let model: string;
    try {
      model = validateModelId(body.model);
      if (!(await isNaiModelEnabled(model))) return NextResponse.json({ message: "该 NAI 模型已被管理员停用" }, { status: 403 });
    }
    catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "模型 ID 无效" }, { status: 400 }); }
    try {
      if (!await providerAllowsModel(session.userId, provider, model)) return NextResponse.json({ message: "该模型未在此第三方 API 的模型列表中" }, { status: 400 });
    } catch (error) {
      return NextResponse.json({ message: safeUpstreamMessage(error, { secrets: [provider.apiKey], urls: [provider.baseUrl], fallback: "无法读取第三方 API 模型列表" }) }, { status: 502 });
    }
    return handleImageModelGeneration(request, session, { ...body, model }, {
      apiKey: provider.apiKey,
      upstreamUrl: provider.baseUrl,
      protocol: resolveProviderImageProtocol(provider.protocol, provider.baseUrl),
      paymentSource: "personal-key",
      rateChecked: true,
      send: (upstream) => withModelConcurrencySlot(() => safeProviderFetch(provider.baseUrl, upstream.path, { method: "POST", headers: upstream.headers, body: upstream.body, timeoutMs: IMAGE_UPSTREAM_TIMEOUT_MS, signal: request.signal }), request.signal),
    });
  }
  let model: string;
  let samples: number;
  let width: number;
  let height: number;
  let steps: number;
  try {
    model = validateModelId(body.model);
    samples = normalizeSamples(body);
    width = normalizeDimension(body.width, "width");
    height = normalizeDimension(body.height, "height");
    steps = normalizeSteps(body.steps);
    validateImageShape(width, height);
    const pricingOperation = typeof body.operation === "string" ? body.operation : "generate";
    validateNaiGenerationCost(model, width, height, steps, imagePricingStrength(body, pricingOperation), pricingOperation);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "图像参数无效" }, { status: 400 });
  }
  const operation = typeof body.operation === "string" ? body.operation : "generate";
  const deferHistory = body.editor_composite === true;
  const images: string[] = [];
  const usage: unknown = null;
  const audit = await startRequestAudit({ request, source: "lfn", endpoint: request.url, userId: session.userId, username: session.username, operation, model, parameters: body });
  try {
    assertImageModel(model);
    if (!(await isNaiModelEnabled(model))) return NextResponse.json({ message: "该 NAI 模型已被管理员停用" }, { status: 403 });
  }
  catch { return NextResponse.json({ message: "NovelAI 官方账号需要选择 NovelAI 图像模型" }, { status: 400 }); }
  if (!nativeOperations.has(operation)) return NextResponse.json({ message: "此操作尚不支持 NovelAI 官方 Key" }, { status: 400 });
  const key = await getNovelaiKey(session.userId);
  if (!key) return NextResponse.json({ message: "请先在设置中导入 NovelAI Key" }, { status: 400 });
  const runBatch = async (batch: number, offset: number) => {
    const nativeBody = naiNativeGenerationBody({ ...body, width, height, steps, n: batch, n_samples: batch, seed: typeof body.seed === "number" && body.seed !== 0 ? (body.seed + offset) % 2 ** 32 : undefined }, { samples: batch });
    return generateNovelaiImage(key, nativeBody);
  };

  try {
    for (const batch of splitImageBatches(samples, MAX_IMAGE_REQUEST_SAMPLES)) {
      const next = await runBatch(batch, images.length);
      if (!next.length) throw new Error("上游没有返回图片");
      images.push(...next);
    }
    const marked = await watermarkImages(images, session.userId, model, { requestId: audit.requestId, requestFingerprint: audit.requestFingerprint, parameters: body });
    images.splice(0, images.length, ...marked.images);
    const history = deferHistory ? [] : await saveHistory(session.userId, body, images, usage, { requestId: audit.requestId, requestFingerprint: audit.requestFingerprint, skipWatermark: true, watermarkStatus: marked.status });
    const historyIds = history.map((item) => item.id);
    await audit.finish({ historyIds, generatedSamples: images.length, status: 200, paymentSource: "personal-key", watermarkStatus: marked.status });
    return NextResponse.json({ images, image: images[0], historyIds, requestId: audit.requestId, usage, payment: "personal-key", paymentSource: "personal-key", aff: null }, { headers: audit.responseHeaders({ "X-LFN-Payment-Source": "personal-key" }) });
  } catch (error) {
    const message = safeUpstreamMessage(error, { secrets: [key], urls: ["https://image.novelai.net"], fallback: "个人 API 生图失败" });
    await audit.finish({ generatedSamples: images.length, status: images.length ? 207 : 502, error: message });
    return NextResponse.json({ message: images.length ? `已生成 ${images.length}/${samples} 张后中断：${message}` : message, requestId: audit.requestId, ...(images.length ? { images, image: images[0], partial: true } : {}) }, { status: images.length ? 207 : 502, headers: audit.responseHeaders() });
  }
}
