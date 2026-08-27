import { NextResponse } from "next/server";
import { refundAff, trySpendAff } from "@/lib/aff";
import { getSession } from "@/lib/session";
import { affGateway, getImageToken, imageFromResult, newApiBaseUrl } from "@/lib/newapi";
import { saveHistory } from "@/lib/history";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

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

const DATA_URL = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

// NovelAI 按分辨率限制单次请求张数（如 832x1216 最多 4 张），超量整单 400。
// 服务端先按保守值拆批，若上游报出更小上限再自适应重拆。
const MAX_SAMPLES_PER_REQUEST = 4;
const MAX_SAMPLES_TOTAL = 12;

// 浏览器上传得到的是 data URL，NovelAI 只接受裸 base64；参考图嵌在数组里需递归。
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
  if (operation === "precise-reference") return Array.isArray(body.references) ? body.references.length : 0;
  if (operation === "character-reference") return Array.isArray(body.characters) ? body.characters.length : 0;
  return imageCount(body.reference_images) || imageCount(body.reference_image);
}

// NovelAI 上游对不支持的参数只回 500，需要据请求内容给出可操作的提示。
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
    return `NovelAI 上游拒绝了本次请求（500）。请调整采样器、噪声调度或高级参数后重试。原始信息：${raw}`;
  return `NovelAI 上游不支持当前${suspects.join("、")}，已返回 500。请更换后重试。`;
}

// 从上游报错中解析分辨率张数上限（如 "Maximum number of images ... is 4"）。
function parseSamplesLimit(raw: string): number | null {
  const match = raw.match(/maximum number of images[^]*?is (\d+)/i);
  return match ? Number(match[1]) : null;
}

// 把总张数拆成不超过 perRequest 的批次（6 -> [4, 2]）。
function splitBatches(total: number, perRequest: number): number[] {
  const batches: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    batches.push(Math.min(perRequest, remaining));
    remaining -= perRequest;
  }
  return batches;
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
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  const operation =
    typeof body.operation === "string" ? body.operation : "generate";
  const model = typeof body.model === "string" ? body.model : "";
  if (!model)
    return NextResponse.json({ message: "缺少模型参数" }, { status: 400 });
  if (["upscale", "annotate"].includes(operation)) {
    return NextResponse.json(
      {
        message: `${operation === "upscale" ? "图片放大" : "控制图生成"}端点已识别，但 Gateway 尚无可审计 usage 映射；为避免零费用漏计，暂不允许提交。`,
      },
      { status: 409 },
    );
  }
  if (operation !== "suggest-tags" && !unifiedOperations.has(operation))
    return NextResponse.json({ message: "不支持的 NAI 操作" }, { status: 400 });
  // 上游只允许 inpaint 模型执行 infill，否则会返回难以理解的英文报错。
  if (
    ["inpainting", "edits"].includes(operation) &&
    !model.includes("inpaint")
  )
    return NextResponse.json(
      { message: `局部重绘需要选择重绘专用模型，${model} 不支持该操作` },
      { status: 400 },
    );

  let affCost = 0;
  let affBalance: number | null = null;
  let affRefunded = false;
  let payment: "aff" | "newapi" = "newapi";
  let baseUrlOverride = "";
  try {
    let token: string;
    let totalSamples = 1;
    if (operation !== "suggest-tags") {
      const width = typeof body.width === "number" ? body.width : 0;
      const height = typeof body.height === "number" ? body.height : 0;
      if (!width || !height)
        return NextResponse.json({ message: "缺少图像尺寸" }, { status: 400 });
      totalSamples =
        typeof body.n === "number" ? body.n : typeof body.n_samples === "number" ? body.n_samples : 1;
      if (!Number.isInteger(totalSamples) || totalSamples < 1 || totalSamples > MAX_SAMPLES_TOTAL)
        return NextResponse.json(
          { message: `生成张数必须在 1-${MAX_SAMPLES_TOTAL} 之间` },
          { status: 400 },
        );
      const generation = {
        model,
        width,
        height,
        steps: typeof body.steps === "number" ? body.steps : 28,
        samples: totalSamples,
        strength: typeof body.strength === "number" ? body.strength : undefined,
        operation,
        referenceImageCount: referenceImageCount(body, operation),
      };
      const gateway = affGateway();
      const aff = gateway
        ? await trySpendAff(session.userId, generation)
        : null;
      if (aff && gateway) {
        token = gateway.token;
        baseUrlOverride = gateway.baseUrl;
        payment = "aff";
        affCost = aff.cost;
        affBalance = aff.balance;
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
    if (operation !== "suggest-tags" && operation !== "generate")
      payload.novelai_operation = operation;
    if (operation === "generate") delete payload.novelai_operation;

    // 按上游单请求张数上限拆批（如 6 张 -> 4+2），合并所有批次图片。
    // 上游若报出更小上限（如 "is 2"），自适应重拆剩余批次。
    let perRequest = Math.max(1, Math.min(MAX_SAMPLES_PER_REQUEST, totalSamples));
    const remaining: number[] = splitBatches(totalSamples, perRequest);
    const images: string[] = [];
    let usage: unknown = null;
    let vibe: unknown = null;
    let generatedSamples = 0;
    let lastStatus = 0;
    let lastRaw = "";
    let lastResult: Record<string, unknown> = {};
    while (remaining.length) {
      const batch = remaining.shift() as number;
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
      // 上游失败时可能返回空 body，直接 json() 会抛错并盖掉真实状态码。
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
        // 上游报出更小的单请求上限时，重拆当前批次后重试一次。
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
      generatedSamples += batch;
      lastResult = result;
      if (result.usage) usage = result.usage;
      if (result.data?.[0]?.vibe) vibe = result.data[0].vibe;
    }

    if (lastRaw) {
      // 部分成功时只对未生成批次按比例退款；全失败则全额退。
      if (payment === "aff" && affCost > 0) {
        const perSampleCost = affCost / totalSamples;
        const refund = Math.max(0, Math.round(affCost - perSampleCost * generatedSamples));
        if (refund > 0) {
          affRefunded = true;
          await refundAff(
            session.userId,
            refund,
            generatedSamples
              ? `部分批次失败，返还 ${refund} AFF`
              : "上游生成失败，自动返还",
          );
        }
      }
      const message = generatedSamples
        ? `已生成 ${generatedSamples}/${totalSamples} 张后中断：${lastRaw}`
        : lastRaw;
      const response: Record<string, unknown> = {
        message,
        ...(generatedSamples ? { images, image: images[0], partial: true } : {}),
      };
      return NextResponse.json(response, { status: generatedSamples ? 207 : lastStatus });
    }
    if (operation === "suggest-tags")
      return NextResponse.json({ tags: lastResult.tags || lastResult, raw: lastResult });
    const history = await saveHistory(
      session.userId,
      body,
      images,
      usage,
    );
    return NextResponse.json({
      images,
      image: images[0],
      usage,
      vibe,
      historyIds: history.map((item) => item.id),
      payment,
      aff: affBalance == null ? null : { cost: affCost, balance: affBalance },
    });
  } catch (error) {
    if (!affRefunded)
      await refundAff(session.userId, affCost, "生成请求异常，自动返还");
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "NAI 操作失败" },
      { status: 502 },
    );
  }
}
