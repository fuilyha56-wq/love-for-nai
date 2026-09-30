import { NextResponse } from "next/server";
import { splitImageBatches, MAX_IMAGE_REQUEST_SAMPLES } from "@/lib/image-batches";
import { saveHistory } from "@/lib/history";
import { checkImageRateLimit, normalizeDimension, normalizeSamples, normalizeSteps, validateImageShape, assertImageModel } from "@/lib/image-request";
import { imageFromResult } from "@/lib/newapi";
import { naiNativeGenerationBody } from "@/lib/nai-native-request";
import type { LfnSession } from "@/lib/session";
import { safeProviderFetch } from "./http";
import { providerAllowsModel } from "./models";
import { generateNovelaiImage } from "./novelai";
import { getNovelaiKey, getProvider } from "./store";
import { ProviderInputError, validateModelId } from "./validation";

const nativeOperations = new Set(["generate", "img2img", "inpainting", "edits", "outpainting", "vibe-transfer", "character-reference", "precise-reference"]);

export async function handlePersonalProviderGeneration(request: Request, session: LfnSession, body: Record<string, unknown>, providerId: string): Promise<NextResponse> {
  const rate = checkImageRateLimit(request, `session:${session.userId}`);
  if (!rate.allowed) return NextResponse.json({ message: "图像请求过于频繁，请稍后重试" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
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
  let usage: unknown = null;
  let runBatch: (batch: number, offset: number) => Promise<string[]>;

  if (providerId === "novelai") {
    try { assertImageModel(model); }
    catch { return NextResponse.json({ message: "NovelAI 官方账号需要选择 NovelAI 图像模型" }, { status: 400 }); }
    if (!nativeOperations.has(operation)) return NextResponse.json({ message: "此操作尚不支持 NovelAI 官方 Key" }, { status: 400 });
    const key = await getNovelaiKey(session.userId);
    if (!key) return NextResponse.json({ message: "请先在设置中导入 NovelAI Key" }, { status: 400 });
    runBatch = async (batch, offset) => {
      const nativeBody = naiNativeGenerationBody({ ...body, width, height, steps, n: batch, n_samples: batch, seed: typeof body.seed === "number" ? (body.seed + offset) % 2 ** 32 : body.seed }, { samples: batch });
      return generateNovelaiImage(key, nativeBody);
    };
  } else {
    const provider = await getProvider(session.userId, providerId);
    if (!provider) return NextResponse.json({ message: "找不到该第三方 API 配置" }, { status: 404 });
    if (operation !== "generate") return NextResponse.json({ message: "第三方 OpenAI 兼容 API 目前仅支持文生图" }, { status: 400 });
    if (!await providerAllowsModel(session.userId, provider, model)) return NextResponse.json({ message: "该模型未在此第三方 API 的模型列表中" }, { status: 400 });
    runBatch = async (batch) => {
      const response = await safeProviderFetch(provider.baseUrl, "/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: typeof body.prompt === "string" ? body.prompt : "", n: batch, size: `${width}x${height}`, response_format: "b64_json" }),
        timeoutMs: 180_000,
      });
      if (!response.ok) throw new Error(`第三方 API 生图失败（${response.status}）`);
      const result = await response.json() as { data?: Array<{ b64_json?: string; url?: string }>; usage?: unknown };
      usage = result.usage ?? usage;
      return imageFromResult(result);
    };
  }

  try {
    for (const batch of splitImageBatches(samples, MAX_IMAGE_REQUEST_SAMPLES)) {
      const next = await runBatch(batch, images.length);
      if (!next.length) throw new Error("上游没有返回图片");
      images.push(...next);
    }
    const history = deferHistory ? [] : await saveHistory(session.userId, body, images, usage);
    return NextResponse.json({ images, image: images[0], historyIds: history.map((item) => item.id), usage, payment: "personal-key", paymentSource: "personal-key", aff: null }, { headers: { "X-LFN-Payment-Source": "personal-key" } });
  } catch (error) {
    const message = error instanceof ProviderInputError ? error.message : error instanceof Error ? error.message : "个人 API 生图失败";
    return NextResponse.json({ message: images.length ? `已生成 ${images.length}/${samples} 张后中断：${message}` : message, ...(images.length ? { images, image: images[0], partial: true } : {}) }, { status: images.length ? 207 : 502 });
  }
}
