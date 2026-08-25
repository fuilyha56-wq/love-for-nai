import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getImageToken, isNaiImageModel, newApiBaseUrl } from "@/lib/newapi";

type AssistantPayload = {
  model?: string;
  request?: string;
  currentPrompt?: string;
  currentNegativePrompt?: string;
};
type AssistantSuggestion = {
  prompt?: string;
  negativePrompt?: string;
  tags?: string[];
  parameters?: {
    width?: number;
    height?: number;
    steps?: number;
    scale?: number;
    sampler?: string;
    noiseSchedule?: string;
    seed?: number;
  };
};
type ChatResult = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};
type DanbooruTag = { name: string; category: number; post_count: number };

const categoryNames: Record<number, string> = {
  0: "通用",
  1: "画师",
  3: "作品",
  4: "角色",
  5: "元数据",
};

function parseSuggestion(content: string): AssistantSuggestion {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("模型未返回可读取的建议");
  return JSON.parse(match[0]) as AssistantSuggestion;
}

function normalizeTag(name: string): string {
  return name.trim().toLowerCase().replaceAll(" ", "_");
}

type ValidatedTag = {
  name: string;
  displayName: string;
  categoryName: string;
  postCount: number;
};
// 区分「标签不存在」与「校验不可用」，后者不应被报告为已拒绝。
type ValidationResult =
  | { status: "valid"; tag: ValidatedTag }
  | { status: "rejected" }
  | { status: "unavailable" };

async function validateTag(name: string): Promise<ValidationResult> {
  const normalized = normalizeTag(name);
  if (!normalized) return { status: "rejected" };
  const params = new URLSearchParams({
    "search[name]": normalized,
    limit: "1",
  });
  try {
    const response = await fetch(
      `https://danbooru.donmai.us/tags.json?${params}`,
      {
        headers: {
          "User-Agent": "Love-for-NAI/0.1 (assistant tag validation)",
        },
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) return { status: "unavailable" };
    const [tag] = (await response.json()) as DanbooruTag[];
    if (!tag || tag.name !== normalized) return { status: "rejected" };
    return {
      status: "valid",
      tag: {
        name: tag.name,
        displayName: tag.name.replaceAll("_", " "),
        categoryName: categoryNames[tag.category] || "其他",
        postCount: tag.post_count,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后使用智能标签助手" },
      { status: 401 },
    );
  const body = (await request.json()) as AssistantPayload;
  if (!body.model || isNaiImageModel(body.model))
    return NextResponse.json(
      { message: "请选择一个文本对话模型" },
      { status: 400 },
    );
  if (!body.request?.trim() || body.request.length > 1000)
    return NextResponse.json(
      { message: "请输入不超过 1000 字的创作需求" },
      { status: 400 },
    );

  try {
    const key = await getImageToken(session);
    const upstream = await fetch(`${newApiBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body.model,
        stream: false,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是 NovelAI 图像提示词助手。只输出 JSON，字段为 prompt、negativePrompt、tags、parameters。tags 必须是 Danbooru 风格英文标签数组；parameters 仅可包含 width、height、steps、scale、sampler、noiseSchedule、seed。不要输出 Markdown。",
          },
          {
            role: "user",
            content: JSON.stringify({
              request: body.request,
              currentPrompt: body.currentPrompt || "",
              currentNegativePrompt: body.currentNegativePrompt || "",
            }),
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const result = (await upstream.json()) as ChatResult;
    if (!upstream.ok || result.error)
      throw new Error(result.error?.message || "模型助手调用失败");
    const content = result.choices?.[0]?.message?.content || "";
    const suggestion = parseSuggestion(content);
    const candidates = [...new Set((suggestion.tags || []).slice(0, 16))];
    const results = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        result: await validateTag(candidate),
      })),
    );
    return NextResponse.json({
      suggestion: {
        prompt: suggestion.prompt || "",
        negativePrompt: suggestion.negativePrompt || "",
        parameters: suggestion.parameters || {},
        tags: results.flatMap((item) =>
          item.result.status === "valid" ? [item.result.tag] : [],
        ),
      },
      rejectedTags: results
        .filter((item) => item.result.status === "rejected")
        .map((item) => item.candidate),
      unverifiedTags: results
        .filter((item) => item.result.status === "unavailable")
        .map((item) => item.candidate),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "智能标签助手调用失败",
      },
      { status: 502 },
    );
  }
}
