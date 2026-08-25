import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getImageToken, imageFromResult, newApiBaseUrl } from "@/lib/newapi";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: "请先登录后生成" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown> & {
    model?: string;
    prompt?: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
  };
  if (!body.model || !body.prompt || !body.width || !body.height)
    return NextResponse.json({ message: "生成参数不完整" }, { status: 400 });
  if (!body.model.startsWith("nai-v"))
    return NextResponse.json(
      { message: "当前模型不允许使用" },
      { status: 400 },
    );

  const baseUrl = newApiBaseUrl();
  try {
    const key = await getImageToken(session);
    const upstream = await fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        negative_prompt: body.negative_prompt || body.negativePrompt || "",
        size: `${body.width}x${body.height}`,
        response_format: "b64_json",
        negativePrompt: undefined,
      }),
      cache: "no-store",
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
