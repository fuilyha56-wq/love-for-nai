import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getImageToken, newApiBaseUrl } from "@/lib/newapi";

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

async function validateTag(name: string) {
  const normalized = name.trim().toLowerCase().replaceAll(" ", "_");
  if (!normalized) return null;
  const params = new URLSearchParams({
    "search[name]": normalized,
    limit: "1",
  });
  const response = await fetch(
    `https://danbooru.donmai.us/tags.json?${params}`,
    {
      headers: { "User-Agent": "Love-for-NAI/0.1 (assistant tag validation)" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) return null;
  const [tag] = (await response.json()) as DanbooruTag[];
  if (!tag || tag.name !== normalized) return null;
  return {
    name: tag.name,
    displayName: tag.name.replaceAll("_", " "),
    categoryName: categoryNames[tag.category] || "其他",
    postCount: tag.post_count,
  };
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后使用智能标签助手" },
      { status: 401 },
    );
  const body = (await request.json()) as AssistantPayload;
  if (!body.model || body.model.toLowerCase().startsWith("nai-"))
    return NextResponse.json(
      { message: "请选择一个非 NAI 文本模型" },
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
    const validatedTags = (
      await Promise.all(candidates.map((tag) => validateTag(tag)))
    ).filter((tag) => tag !== null);
    return NextResponse.json({
      suggestion: {
        prompt: suggestion.prompt || "",
        negativePrompt: suggestion.negativePrompt || "",
        parameters: suggestion.parameters || {},
        tags: validatedTags,
      },
      rejectedTags: candidates.filter(
        (candidate) =>
          !validatedTags.some(
            (tag) =>
              tag.name === candidate.trim().toLowerCase().replaceAll(" ", "_"),
          ),
      ),
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
