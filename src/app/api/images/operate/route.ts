import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getImageToken, imageFromResult, newApiBaseUrl } from "@/lib/newapi";
import { saveHistory } from "@/lib/history";

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

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后使用 NAI 工具" },
      { status: 401 },
    );
  const body = (await request.json()) as Record<string, unknown> & {
    operation?: string;
  };
  const operation = body.operation || "generate";
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

  try {
    const key = await getImageToken(session);
    const baseUrl = newApiBaseUrl();
    const endpoint =
      operation === "suggest-tags"
        ? "/v1/images/suggest-tags"
        : "/v1/images/generations";
    const payload = { ...body };
    delete payload.operation;
    if (operation !== "suggest-tags" && operation !== "generate")
      payload.novelai_operation = operation;
    if (operation === "generate") delete payload.novelai_operation;

    const upstream = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.includes("application/json"))
      return NextResponse.json(
        { message: "上游返回了未支持的二进制响应" },
        { status: 502 },
      );
    const result = await upstream.json();
    if (!upstream.ok || result.error || result.detail)
      return NextResponse.json(
        {
          message:
            result.error?.message ||
            result.detail ||
            result.message ||
            "上游操作失败",
        },
        { status: upstream.status || 502 },
      );
    if (operation === "suggest-tags")
      return NextResponse.json({ tags: result.tags || result, raw: result });
    const images = imageFromResult(result);
    if (!images.length)
      return NextResponse.json({ message: "上游未返回图片" }, { status: 502 });
    const history = await saveHistory(
      session.userId,
      body,
      images,
      result.usage || null,
    );
    return NextResponse.json({
      images,
      image: images[0],
      usage: result.usage || null,
      vibe: result.data?.[0]?.vibe || null,
      historyIds: history.map((item) => item.id),
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "NAI 操作失败" },
      { status: 502 },
    );
  }
}
