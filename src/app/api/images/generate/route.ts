import { NextResponse } from "next/server";
import {
  refundImageCredits,
  trySpendImageCredits,
  type ImageCreditCharge,
} from "@/lib/aff";
import { getSession } from "@/lib/session";
import { affGateway, getImageToken, imageFromResult, newApiBaseUrl } from "@/lib/newapi";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";
import {
  assertBodySize,
  assertImageModel,
  checkImageRateLimit,
  ImageRequestValidationError,
  normalizeDimension,
  normalizeSamples,
  normalizeSteps,
  validateImageShape,
} from "@/lib/image-request";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: "请先登录后生成" }, { status: 401 });
  let body: Record<string, unknown> & {
    model?: string;
    prompt?: string;
    negative_prompt?: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
  };
  try {
    assertBodySize(request);
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  if (!body.model || !body.prompt || body.width == null || body.height == null)
    return NextResponse.json({ message: "生成参数不完整" }, { status: 400 });

  let model: string;
  let width: number;
  let height: number;
  let steps: number;
  let samples: number;
  try {
    model = assertImageModel(body.model);
    width = normalizeDimension(body.width, "width");
    height = normalizeDimension(body.height, "height");
    validateImageShape(width, height);
    steps = normalizeSteps(body.steps);
    samples = normalizeSamples(body);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "生成参数无效" },
      { status: error instanceof ImageRequestValidationError ? 400 : 400 },
    );
  }
  const rate = checkImageRateLimit(request, `session:${session.userId}`);
  if (!rate.allowed)
    return NextResponse.json(
      { message: "图像请求过于频繁，请稍后重试" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  // 只转发白名单字段，避免调用方注入 novelai_operation 绕过本端点的模型限制。
  const forwarded = [
    "scale",
    "sampler",
    "noise_schedule",
    "cfg_rescale",
    "seed",
  ];
  const gateway = affGateway();
  let creditCharge: ImageCreditCharge | null = null;
  let affRefunded = false;
  let payment: "aff" | "newapi" = "newapi";
  let paymentSource: "package" | "personal" | "mixed" | "newapi" = "newapi";
  let upstreamBaseUrl = newApiBaseUrl();
  let upstreamAttempted = false;
  try {
    const generation = {
      model,
      width,
      height,
      steps,
      samples,
    };
    const aff = gateway
      ? await trySpendImageCredits(session.userId, generation)
      : null;
    let key: string;
    if (aff && gateway) {
      key = gateway.token;
      upstreamBaseUrl = gateway.baseUrl;
      payment = "aff";
      creditCharge = aff;
      paymentSource =
        aff.packageCost > 0 && aff.personalCost > 0
          ? "mixed"
          : aff.packageCost > 0
            ? "package"
            : "personal";
    } else {
      key = await getImageToken(session, body.model);
    }
    upstreamAttempted = true;
    const upstream = await fetch(`${upstreamBaseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...Object.fromEntries(
          forwarded
            .filter((key) => body[key] !== undefined)
            .map((key) => [key, body[key]]),
        ),
        model,
        prompt: body.prompt,
        negative_prompt: body.negative_prompt || body.negativePrompt || "",
        size: `${width}x${height}`,
        n: samples,
        n_samples: samples,
        steps,
        response_format: "b64_json",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const result = await upstream.json();
    if (!upstream.ok || result.error) {
      if (creditCharge) {
        affRefunded = true;
        await refundImageCredits(session.userId, creditCharge, 0);
      }
      return NextResponse.json(
        { message: result.error?.message || result.message || "上游生成失败" },
        { status: upstream.status || 502 },
      );
    }
    const images = imageFromResult(result);
    if (!images.length) {
      if (creditCharge) {
        affRefunded = true;
        await refundImageCredits(session.userId, creditCharge, 0);
      }
      return NextResponse.json({ message: "上游未返回图片" }, { status: 502 });
    }
    return NextResponse.json({
      image: images[0],
      images,
      usage: result.usage || null,
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
      payment,
      paymentSource,
      affCredits: creditCharge
        ? {
            cost: creditCharge.cost,
            packageCost: creditCharge.packageCost,
            personalCost: creditCharge.personalCost,
            balance: creditCharge.balance,
            packageBalance: creditCharge.packageBalance,
            totalBalance: creditCharge.totalBalance,
          }
        : null,
    });
  } catch (error) {
    if (!affRefunded && creditCharge && !upstreamAttempted) {
      affRefunded = true;
      await refundImageCredits(session.userId, creditCharge, 0);
    }
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "生成请求失败" },
      { status: 502 },
    );
  }
}
