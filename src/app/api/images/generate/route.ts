import { NextResponse } from "next/server";
import {
  refundImageCredits,
  trySpendImageCredits,
  type ImageCreditCharge,
} from "@/lib/aff";
import { getSession } from "@/lib/session";
import { affGateway, getImageToken, imageFromResult, newApiBaseUrl } from "@/lib/newapi";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

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
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  if (!body.model || !body.prompt || !body.width || !body.height)
    return NextResponse.json({ message: "生成参数不完整" }, { status: 400 });
  if (!body.model.startsWith("nai-v"))
    return NextResponse.json(
      { message: "当前模型不允许使用" },
      { status: 400 },
    );

  // 只转发白名单字段，避免调用方注入 novelai_operation 绕过本端点的模型限制。
  const forwarded = [
    "steps",
    "scale",
    "n",
    "n_samples",
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
  try {
    const generation = {
      model: body.model,
      width: body.width,
      height: body.height,
      steps: typeof body.steps === "number" ? body.steps : 28,
      samples: typeof body.n === "number" ? body.n : typeof body.n_samples === "number" ? body.n_samples : 1,
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
        model: body.model,
        prompt: body.prompt,
        negative_prompt: body.negative_prompt || body.negativePrompt || "",
        size: `${body.width}x${body.height}`,
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
    if (!affRefunded && creditCharge) {
      affRefunded = true;
      await refundImageCredits(session.userId, creditCharge, 0);
    }
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "生成请求失败" },
      { status: 502 },
    );
  }
}
