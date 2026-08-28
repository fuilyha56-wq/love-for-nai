import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getChatToken, isNaiImageModel } from "@/lib/newapi";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";
import { outboundFetch } from "@/lib/outbound";
import { runTagAgent } from "@/lib/tag-agent";
import { parseTagSuggestion } from "@/lib/tag-suggestion";
import {
  createAssistantJob,
  findAssistantJob,
  type AssistantJob,
} from "@/lib/assistant-jobs";

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

// 校验过的标签必须可靠进入正向提示词：模型漏写时按序追加。
function mergeTagsIntoPrompt(
  prompt: string,
  tags: ValidatedTag[],
): string {
  if (!tags.length) return prompt;
  const base = prompt.trim();
  const present = new Set(
    base
      .split(",")
      .map((part) => normalizeTag(part))
      .filter(Boolean),
  );
  const missing = tags
    .map((tag) => tag.name)
    .filter((name) => !present.has(normalizeTag(name)));
  if (!missing.length) return base;
  return base ? `${base}, ${missing.join(", ")}` : missing.join(", ");
}

// 后台执行：结果写入任务对象，客户端通过 GET 轮询取步骤与最终建议。
async function runJob(
  job: AssistantJob,
  key: string,
  model: string,
  request: string,
  context: { currentPrompt?: string; currentNegativePrompt?: string },
) {
  try {
    const { content, steps } = await runTagAgent(key, model, request, context);
    job.steps = steps;
    const suggestion = parseTagSuggestion(content);
    const candidates = [...new Set(suggestion.tags)];
    const results = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        result: await validateTag(candidate),
      })),
    );
    const validTags = results.flatMap((item) =>
      item.result.status === "valid" ? [item.result.tag] : [],
    );
    job.result = {
      suggestion: {
        prompt: mergeTagsIntoPrompt(suggestion.prompt, validTags),
        negativePrompt: suggestion.negativePrompt,
        parameters: suggestion.parameters,
        tags: validTags,
      },
      rejectedTags: results
        .filter((item) => item.result.status === "rejected")
        .map((item) => item.candidate),
      unverifiedTags: results
        .filter((item) => item.result.status === "unavailable")
        .map((item) => item.candidate),
    };
    job.status = "done";
  } catch (error) {
    job.message =
      error instanceof Error ? error.message : "智能标签助手调用失败";
    job.status = "error";
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
    const job = createAssistantJob(session.userId);
    void runJob(job, key, body.model, body.request, {
      currentPrompt: body.currentPrompt,
      currentNegativePrompt: body.currentNegativePrompt,
    });
    return NextResponse.json({ jobId: job.id });
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

export async function GET(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后使用智能标签助手", sessionExpired: true },
      { status: 401 },
    );
  const url = new URL(request.url);
  const job = findAssistantJob(session.userId, url.searchParams.get("job") || "");
  if (!job)
    return NextResponse.json(
      { message: "任务不存在或已过期，请重新发起" },
      { status: 404 },
    );
  if (job.status === "running")
    return NextResponse.json({ status: "running", steps: job.steps });
  if (job.status === "error")
    return NextResponse.json(
      { status: "error", message: job.message, steps: job.steps },
      { status: 200 },
    );
  return NextResponse.json({ status: "done", steps: job.steps, ...job.result });
}
