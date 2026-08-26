import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getChatToken, isNaiImageModel } from "@/lib/newapi";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";
import { outboundFetch } from "@/lib/outbound";
import { runTagAgent } from "@/lib/tag-agent";
import { parseTagSuggestion } from "@/lib/tag-suggestion";

type AssistantPayload = {
  model?: string;
  request?: string;
  currentPrompt?: string;
  currentNegativePrompt?: string;
};
type DanbooruTag = { name: string; category: number; post_count: number };

const categoryNames: Record<number, string> = {
  0: "通用",
  1: "画师",
  3: "作品",
  4: "角色",
  5: "元数据",
};

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
    const response = await outboundFetch(
      `https://danbooru.donmai.us/tags.json?${params}`,
      {
        headers: {
          "User-Agent": "Love-for-NAI/0.1 (assistant tag validation)",
        },
        signal: AbortSignal.timeout(15_000),
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
  let body: AssistantPayload;
  try {
    body = await parseJsonBody<AssistantPayload>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  if (typeof body.model !== "string" || isNaiImageModel(body.model))
    return NextResponse.json(
      { message: "请选择一个文本对话模型" },
      { status: 400 },
    );
  if (
    typeof body.request !== "string" ||
    !body.request.trim() ||
    body.request.length > 1000
  )
    return NextResponse.json(
      { message: "请输入不超过 1000 字的创作需求" },
      { status: 400 },
    );

  try {
    const key = await getChatToken(session, body.model);
    const { content, steps } = await runTagAgent(
      key,
      body.model,
      body.request,
      {
        currentPrompt: body.currentPrompt,
        currentNegativePrompt: body.currentNegativePrompt,
      },
    );
    const suggestion = parseTagSuggestion(content);
    const candidates = [...new Set(suggestion.tags)];
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
      steps,
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
