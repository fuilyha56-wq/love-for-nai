import { NextResponse } from "next/server";
import { refundAff, spendAff } from "@/lib/aff";
import { getSession } from "@/lib/session";
import { getImageToken, imageFromResult, newApiBaseUrl } from "@/lib/newapi";
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
  try {
    if (operation !== "suggest-tags") {
      const width = typeof body.width === "number" ? body.width : 0;
      const height = typeof body.height === "number" ? body.height : 0;
      if (!width || !height)
        return NextResponse.json({ message: "缺少图像尺寸" }, { status: 400 });
      const aff = await spendAff(session.userId, {
        model,
        width,
        height,
        steps: typeof body.steps === "number" ? body.steps : 28,
        samples: typeof body.n === "number" ? body.n : typeof body.n_samples === "number" ? body.n_samples : 1,
        strength: typeof body.strength === "number" ? body.strength : undefined,
        operation,
        referenceImageCount: referenceImageCount(body, operation),
      });
      affCost = aff.cost;
      affBalance = aff.balance;
    }
    const key = await getImageToken(session, model);
    const baseUrl = newApiBaseUrl();
    const endpoint =
      operation === "suggest-tags"
        ? "/v1/images/suggest-tags"
        : "/v1/images/generations";
    const payload = stripDataUrls({ ...body });
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
      signal: AbortSignal.timeout(180_000),
    });
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      affRefunded = true;
      await refundAff(session.userId, affCost, "上游响应异常，自动返还");
      return NextResponse.json(
        { message: "上游返回了未支持的二进制响应" },
        { status: 502 },
      );
    }
    // 上游失败时可能返回空 body，直接 json() 会抛错并盖掉真实状态码。
    const text = await upstream.text();
    let result: {
      error?: { message?: string };
      detail?: string;
      message?: string;
      tags?: unknown;
      usage?: unknown;
      data?: Array<{ b64_json?: string; url?: string; vibe?: unknown }>;
    } = {};
    if (text.trim()) {
      try {
        result = JSON.parse(text);
      } catch {
        affRefunded = true;
        await refundAff(session.userId, affCost, "上游响应异常，自动返还");
        return NextResponse.json(
          {
            message: explainUpstreamFailure(
              text.slice(0, 200),
              upstream.status,
              body,
            ),
          },
          { status: upstream.ok ? 502 : upstream.status },
        );
      }
    }
    if (!upstream.ok || result.error || result.detail) {
      const raw =
        result.error?.message ||
        result.detail ||
        result.message ||
        (text.trim() ? text.slice(0, 200) : `上游返回空响应（${upstream.status}）`);
      affRefunded = true;
      await refundAff(session.userId, affCost, "上游生成失败，自动返还");
      return NextResponse.json(
        { message: explainUpstreamFailure(raw, upstream.status, body) },
        { status: upstream.status || 502 },
      );
    }
    if (operation === "suggest-tags")
      return NextResponse.json({ tags: result.tags || result, raw: result });
    const images = imageFromResult(result);
    if (!images.length) {
      affRefunded = true;
      await refundAff(session.userId, affCost, "上游未返回图片，自动返还");
      return NextResponse.json({ message: "上游未返回图片" }, { status: 502 });
    }
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
