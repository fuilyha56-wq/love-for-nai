import { NextResponse } from "next/server";
import {
  refundImageCredits,
  trySpendImageCredits,
  type ImageCreditCharge,
} from "@/lib/aff";
import { getSession } from "@/lib/session";
import {
  affGateway,
  getImageToken,
  imageFromResult,
  newApiBaseUrl,
} from "@/lib/newapi";
import { saveHistory } from "@/lib/history";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";
import {
  assertBodySize,
  assertImageModel,
  checkImageRateLimit,
  normalizeDimension,
  normalizeSamples,
  normalizeSteps,
  validateImageShape,
  validateReferenceCount,
} from "@/lib/image-request";

const unifiedOperations = new Set([
  "generate",
  "img2img",
  "inpainting",
  "edits",
  "vibe-transfer",
  "character-reference",
  "precise-reference",
  "director-declutter",
  "director-bg-remover",
  "director-lineart",
  "director-sketch",
  "director-colorize",
  "director-emotion",
]);
const MAX_SAMPLES_PER_REQUEST = 4;
const DATA_URL = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

function stripDataUrls<T>(value: T): T {
  if (typeof value === "string")
    return (DATA_URL.test(value) ? value.replace(DATA_URL, "") : value) as T;
  if (Array.isArray(value)) return value.map(stripDataUrls) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        stripDataUrls(item),
      ]),
    ) as T;
  return value;
}

function imageCount(value: unknown): number {
  if (typeof value === "string") return value.trim() ? 1 : 0;
  if (!Array.isArray(value)) return 0;
  return value.filter((item) => typeof item === "string" && item.trim()).length;
}

function referenceImageCount(
  body: Record<string, unknown>,
  operation: string,
): number {
  if (operation === "precise-reference")
    return Array.isArray(body.references) ? body.references.length : 0;
  if (operation === "character-reference")
    return Array.isArray(body.characters) ? body.characters.length : 0;
  return imageCount(body.reference_images) || imageCount(body.reference_image);
}

function parseSamplesLimit(raw: string): number | null {
  const match = raw.match(/maximum number of images[^]*?is (\d+)/i);
  return match ? Number(match[1]) : null;
}

function splitBatches(total: number, perRequest: number): number[] {
  const batches: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    batches.push(Math.min(perRequest, remaining));
    remaining -= perRequest;
  }
  return batches;
}

function explainUpstreamFailure(
  raw: string,
  status: number,
  body: Record<string, unknown>,
): string {
  if (status !== 500) return raw;
  const suspects: string[] = [];
  if (body.sampler === "ddim_v3") suspects.push("采样器 ddim_v3");
  if (typeof body.cfg_rescale === "number" && body.cfg_rescale !== 0)
    suspects.push("CFG 重缩放");
  if (!suspects.length)
    return `NovelAI 上游拒绝了本次请求（500）。请调整采样器、噪声调度或高级参数后重试。`;
  return `NovelAI 上游不支持当前${suspects.join("、")}，已返回 500。请更换后重试。`;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后使用 NAI 工具" },
      { status: 401 },
    );

  let body: Record<string, unknown> & { operation?: string; model?: string };
  try {
    assertBodySize(request);
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }

  const operation =
    typeof body.operation === "string" ? body.operation : "generate";
  let model: string;
  try {
    model = assertImageModel(body.model);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "当前模型不允许用于图像生成" },
      { status: 400 },
    );
  }
  if (operation === "upscale" || operation === "annotate")
    return NextResponse.json(
      {
        message: `${operation === "upscale" ? "图片放大" : "控制图生成"}端点已识别，但 Gateway 尚无可审计 usage 映射；为避免零费用漏计，暂不允许提交。`,
      },
      { status: 409 },
    );
  if (operation !== "suggest-tags" && !unifiedOperations.has(operation))
    return NextResponse.json({ message: "不支持的 NAI 操作" }, { status: 400 });
  if (
    (operation === "inpainting" || operation === "edits") &&
    !model.includes("inpaint")
  )
    return NextResponse.json(
      { message: `局部重绘需要选择重绘专用模型，${model} 不支持该操作` },
      { status: 400 },
    );

  const rate = checkImageRateLimit(request, `session:${session.userId}`);
  if (!rate.allowed)
    return NextResponse.json(
      { message: "图像请求过于频繁，请稍后重试" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );

  let creditCharge: ImageCreditCharge | null = null;
  let affRefunded = false;
  let generatedSamples = 0;
  let payment: "aff" | "newapi" = "newapi";
  let paymentSource: "package" | "personal" | "mixed" | "newapi" = "newapi";
  let baseUrlOverride = "";
  let upstreamAttempted = false;

  try {
    let token: string;
    let totalSamples = 1;
    let width = 0;
    let height = 0;
    let steps = 28;

    if (operation !== "suggest-tags") {
      try {
        width = normalizeDimension(body.width, "width");
        height = normalizeDimension(body.height, "height");
        validateImageShape(width, height);
        totalSamples = normalizeSamples(body);
        steps = normalizeSteps(body.steps);
        validateReferenceCount(referenceImageCount(body, operation));
      } catch (error) {
        return NextResponse.json(
          { message: error instanceof Error ? error.message : "图像参数无效" },
          { status: 400 },
        );
      }

      const generation = {
        model,
        width,
        height,
        steps,
        samples: totalSamples,
        strength: typeof body.strength === "number" ? body.strength : undefined,
        operation,
        referenceImageCount: referenceImageCount(body, operation),
        characterPromptCount: Array.isArray(body.characterPrompts)
          ? body.characterPrompts.length
          : 0,
      };
      const gateway = affGateway();
      const credits = gateway
        ? await trySpendImageCredits(session.userId, generation)
        : null;
      if (credits && gateway) {
        token = gateway.token;
        baseUrlOverride = gateway.baseUrl;
        payment = "aff";
        creditCharge = credits;
        paymentSource =
          credits.packageCost > 0 && credits.personalCost > 0
            ? "mixed"
            : credits.packageCost > 0
              ? "package"
              : "personal";
      } else {
        token = await getImageToken(session, model);
      }
    } else {
      token = await getImageToken(session, model);
    }

    const baseUrl = baseUrlOverride || newApiBaseUrl();
    const endpoint =
      operation === "suggest-tags"
        ? "/v1/images/suggest-tags"
        : "/v1/images/generations";
    const payload = stripDataUrls({ ...body });
    delete payload.operation;
    delete payload.n;
    delete payload.n_samples;
    if (operation !== "suggest-tags") {
      payload.n = totalSamples;
      payload.n_samples = totalSamples;
      payload.width = width;
      payload.height = height;
      payload.steps = steps;
      if (operation !== "generate") payload.novelai_operation = operation;
      else delete payload.novelai_operation;
    }

    let perRequest = Math.min(MAX_SAMPLES_PER_REQUEST, totalSamples);
    const remaining = splitBatches(totalSamples, perRequest);
    const images: string[] = [];
    let usage: unknown = null;
    let vibe: unknown = null;
    let lastStatus = 0;
    let lastRaw = "";
    let lastResult: Record<string, unknown> = {};

    while (remaining.length) {
      const batch = remaining.shift() as number;
      upstreamAttempted = true;
      const upstream = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...payload, n: batch, n_samples: batch }),
        cache: "no-store",
        signal: AbortSignal.timeout(180_000),
      });
      const contentType = upstream.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        lastStatus = 502;
        lastRaw = "上游返回了未支持的二进制响应";
        break;
      }
      const text = await upstream.text();
      let result: {
        error?: { message?: string };
        detail?: string;
        message?: string;
        usage?: unknown;
        data?: Array<{ b64_json?: string; url?: string; vibe?: unknown }>;
      } = {};
      if (text.trim()) {
        try {
          result = JSON.parse(text);
        } catch {
          lastStatus = upstream.ok ? 502 : upstream.status;
          lastRaw = explainUpstreamFailure(text.slice(0, 200), upstream.status, body);
          break;
        }
      }
      if (!upstream.ok || result.error || result.detail) {
        const raw =
          result.error?.message ||
          result.detail ||
          result.message ||
          (text.trim() ? text.slice(0, 200) : `上游返回空响应（${upstream.status}）`);
        const limit = parseSamplesLimit(raw);
        if (limit && limit >= 1 && limit < batch) {
          remaining.unshift(...splitBatches(batch, limit));
          perRequest = Math.min(perRequest, limit);
          continue;
        }
        lastStatus = upstream.status || 502;
        lastRaw = explainUpstreamFailure(raw, upstream.status, body);
        break;
      }
      const batchImages = imageFromResult(result);
      if (!batchImages.length) {
        lastStatus = 502;
        lastRaw = "上游未返回图片";
        break;
      }
      images.push(...batchImages);
      generatedSamples += batchImages.length;
      lastResult = result;
      if (result.usage) usage = result.usage;
      if (result.data?.[0]?.vibe) vibe = result.data[0].vibe;
    }

    if (lastRaw) {
      if (creditCharge) {
        affRefunded = true;
        await refundImageCredits(session.userId, creditCharge, generatedSamples);
      }
      return NextResponse.json(
        {
          message: generatedSamples
            ? `已生成 ${generatedSamples}/${totalSamples} 张后中断：${lastRaw}`
            : lastRaw,
          ...(generatedSamples ? { images, image: images[0], partial: true } : {}),
        },
        { status: generatedSamples ? 207 : lastStatus || 502 },
      );
    }
    if (operation === "suggest-tags")
      return NextResponse.json({ tags: lastResult.tags || lastResult, raw: lastResult });

    const history = await saveHistory(session.userId, body, images, usage);
    return NextResponse.json({
      images,
      image: images[0],
      usage,
      vibe,
      historyIds: history.map((item) => item.id),
      payment,
      paymentSource,
      aff: creditCharge
        ? {
            cost: creditCharge.cost,
            balance: creditCharge.balance,
            packageCost: creditCharge.packageCost,
            personalCost: creditCharge.personalCost,
            packageBalance: creditCharge.packageBalance,
            totalBalance: creditCharge.totalBalance,
          }
        : null,
    });
  } catch (error) {
    if (!affRefunded && creditCharge && !upstreamAttempted) {
      affRefunded = true;
      await refundImageCredits(session.userId, creditCharge, generatedSamples);
    }
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "NAI 操作失败" },
      { status: 502 },
    );
  }
}
