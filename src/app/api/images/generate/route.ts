import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getImageToken, imageFromResult, newApiBaseUrl } from "@/lib/newapi";
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
    "quality_tags",
  ];
  const baseUrl = newApiBaseUrl();
  try {
    const key = await getImageToken(session, body.model);
    const upstream = await fetch(`${baseUrl}/v1/images/generations`, {
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
    if (!upstream.ok || result.error)
      return NextResponse.json(
        { message: result.error?.message || result.message || "上游生成失败" },
        { status: upstream.status || 502 },
      );
    const images = imageFromResult(result);
    if (!images.length)
      return NextResponse.json({ message: "上游未返回图片" }, { status: 502 });
    return NextResponse.json({
      image: images[0],
      images,
      usage: result.usage || null,
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "生成请求失败" },
      { status: 502 },
    );
  }
}
