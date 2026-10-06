import { NextResponse } from "next/server";
import { splitImageBatches, MAX_IMAGE_REQUEST_SAMPLES } from "@/lib/image-batches";
import { saveHistory } from "@/lib/history";
import { watermarkImages } from "@/lib/image-watermark";
import { startRequestAudit } from "@/lib/request-audit";
import { isNaiModelEnabled } from "@/lib/runtime-config";
import { checkImageRateLimit, normalizeDimension, normalizeSamples, normalizeSteps, validateImageShape, assertImageModel } from "@/lib/image-request";
import { naiNativeGenerationBody } from "@/lib/nai-native-request";
import type { LfnSession } from "@/lib/session";
import { safeProviderFetch } from "./http";
import { providerAllowsModel } from "./models";
import { generateNovelaiImage } from "./novelai";
import { getNovelaiKey, getProvider } from "./store";
import { ProviderInputError, validateModelId } from "./validation";
import { resolveProviderImageProtocol } from "@/lib/image-model-capabilities";
import { withModelConcurrencySlot } from "@/lib/model-concurrency";
import { handleImageModelGeneration } from "./image-generation";

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
    if (!await providerAllowsModel(session.userId, provider, model)) return NextResponse.json({ message: "该模型未在此第三方 API 的模型列表中" }, { status: 400 });
    return handleImageModelGeneration(request, session, { ...body, model }, {
      apiKey: provider.apiKey,
      protocol: resolveProviderImageProtocol(provider.protocol, provider.baseUrl),
      paymentSource: "personal-key",
      rateChecked: true,
      send: (upstream) => withModelConcurrencySlot(() => safeProviderFetch(provider.baseUrl, upstream.path, { method: "POST", headers: upstream.headers, body: upstream.body, timeoutMs: 180_000, signal: request.signal }), request.signal),
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
    await audit.finish({ historyIds, status: 200, paymentSource: "personal-key", watermarkStatus: marked.status });
    return NextResponse.json({ images, image: images[0], historyIds, requestId: audit.requestId, usage, payment: "personal-key", paymentSource: "personal-key", aff: null }, { headers: audit.responseHeaders({ "X-LFN-Payment-Source": "personal-key" }) });
  } catch (error) {
    const message = error instanceof ProviderInputError ? error.message : error instanceof Error ? error.message : "个人 API 生图失败";
    await audit.finish({ status: images.length ? 207 : 502, error: message });
    return NextResponse.json({ message: images.length ? `已生成 ${images.length}/${samples} 张后中断：${message}` : message, requestId: audit.requestId, ...(images.length ? { images, image: images[0], partial: true } : {}) }, { status: images.length ? 207 : 502, headers: audit.responseHeaders() });
  }
}
