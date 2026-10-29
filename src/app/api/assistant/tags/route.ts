import { isAssistantConversationId } from "@/lib/assistant-conversations";
import { assistantJobSignal, cancelAssistantJob, cancelConversationJobs } from "@/lib/assistant-jobs";
import { parseAssistantCreativeMemory, type AssistantCreativeMemory } from "@/lib/assistant-memory";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { type Session } from "@/lib/newapi";
import { resolveAssistantSource, AssistantSourceError, type AssistantSource } from "@/lib/assistant-source";
import { ASSISTANT_INPUT_MAX_LENGTH } from "@/lib/assistant-input";
import { MAX_ASSISTANT_IMAGES, MAX_ASSISTANT_IMAGE_BYTES, MAX_ASSISTANT_TOTAL_IMAGE_BYTES, DEFAULT_GOAL_GENERATIONS, MAX_GOAL_GENERATIONS, validGoalGenerations } from "@/lib/assistant-limits";
import { refreshAssistantJobUsage } from "@/lib/assistant-usage-billing";
import { resolveAssistantReasoning } from "@/lib/assistant-reasoning";
import { readCatalogTag } from "@/lib/tag-catalog";
import { isAssistantChatModel } from "@/lib/assistant-models";
import {
  adaptAssistantSuggestion,
  assistantHistoryMatchesTarget,
  resolveAssistantImageTarget,
  type AssistantImageContext,
  type AssistantImageTarget,
} from "@/lib/assistant-model-prompts";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";
import { outboundFetch } from "@/lib/outbound";
import { findHistory, historyImagePath } from "@/lib/history";
import { getRemoteHistoryImage } from "@/lib/remote-history";
import { runTagAgent } from "@/lib/tag-agent";
import { AssistantModelBlockedError } from "@/lib/assistant-model-error";
import { ASSISTANT_JOB_TIMEOUT_MS } from "@/lib/assistant-timing";
import { parseTagSuggestion } from "@/lib/tag-suggestion";
import {
  createAssistantJob,
  findAssistantJob,
  type AssistantJob,
} from "@/lib/assistant-jobs";
import {
  appendConversationTurn,
  clearConversation,
  MODEL_HISTORY_TURNS,
  readConversation,
  type ConversationTag,
  type ConversationTurn,
} from "@/lib/assistant-conversations";

type AssistantPayload = {
  assistantProviderId?: unknown;
  assistantGroup?: unknown;
  reasoningEffort?: unknown;
  model?: string;
  request?: string;
  currentPrompt?: string;
  currentNegativePrompt?: string;
  creativeMemory?: unknown;
  allowWikipedia?: unknown;
  conversationId?: unknown;
  imageModel?: unknown;
  targetImageModel?: unknown;
  modelProtocol?: unknown;
  operation?: unknown;
  localTags?: unknown;
  // 兼容旧客户端的单图 data URL。
  image?: string;
  // 当前用户可访问的历史 ID；服务端读取图片，不信任客户端 URL。
  historyIds?: unknown;
  // data URL 图片数组，最多 10 张。
  images?: unknown;
  goalMode?: unknown;
  accessMode?: unknown;
  goal?: unknown;
  goalIteration?: unknown;
  goalMaxRounds?: unknown;
  goalRunId?: unknown;
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

const DATA_IMAGE_RE =
  /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function validDataImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_ASSISTANT_IMAGE_BYTES &&
    DATA_IMAGE_RE.test(value)
  );
}

async function readHistoryImages(
  userId: number,
  ids: unknown,
): Promise<{ images: string[]; invalid: boolean }> {
  if (!Array.isArray(ids)) return { images: [], invalid: false };
  const uniqueIds = [
    ...new Set(
      ids.filter(
        (id): id is string =>
          typeof id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(id),
      ),
    ),
  ];
  const invalidId =
    ids.length > MAX_ASSISTANT_IMAGES ||
    ids.some(
      (id) =>
        typeof id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id),
    );
  const images: string[] = [];
  let totalBytes = 0;
  let invalid = invalidId;
  for (const id of uniqueIds.slice(0, MAX_ASSISTANT_IMAGES)) {
    const item = await findHistory(userId, id);
    if (!item) {
      invalid = true;
      continue;
    }
    let data: Buffer | null = null;
    if (item.remote) {
      data = (await getRemoteHistoryImage(userId, item.imagePath))?.data ?? null;
    } else {
      data = await readFile(historyImagePath(userId, item.imagePath)).catch(
        () => null,
      );
    }
    if (!data || !data.length || data.length > MAX_ASSISTANT_IMAGE_BYTES) {
      invalid = true;
      continue;
    }
    if (totalBytes + data.length > MAX_ASSISTANT_TOTAL_IMAGE_BYTES) {
      invalid = true;
      break;
    }
    const extension = item.imagePath.split(".").pop()?.toLowerCase();
    const mime = extension === "jpg" ? "jpeg" : extension;
    if (mime !== "png" && mime !== "jpeg" && mime !== "webp") {
      invalid = true;
      continue;
    }
    images.push(`data:image/${mime};base64,${data.toString("base64")}`);
    totalBytes += data.length;
  }
  return { images, invalid };
}

async function validateTag(name: string): Promise<ValidationResult> {
  const normalized = normalizeTag(name);
  if (!normalized) return { status: "rejected" };
  const local = readCatalogTag(normalized);
  if (local && (local.source === "danbooru" || local.name === normalized)) return { status: "valid", tag: { name: local.name, displayName: local.displayName, categoryName: local.categoryName, postCount: local.postCount } };
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

// 后台执行：结果写入任务对象，客户端通过 GET 轮询取步骤与最终建议；
// 成功后把本轮（含校验过的标签）落盘到用户会话，供下一次对话延续。
async function runJob(
  job: AssistantJob,
  session: Session,
  source: AssistantSource,
  model: string,
  request: string,
  context: { currentPrompt?: string; currentNegativePrompt?: string; localTags?: string[]; reasoningEffort?: string; creativeMemory?: AssistantCreativeMemory[]; allowWikipedia?: boolean } & AssistantImageContext,
  images: string[],
  target: AssistantImageTarget,
) {
  const userId = session.userId;
  const jobSignal = AbortSignal.any([assistantJobSignal(job), AbortSignal.timeout(ASSISTANT_JOB_TIMEOUT_MS)]);
  try {
    // 取最近几轮历史注入模型，让 agent 看到之前的上下文。
    const conversation = await readConversation(userId, job.conversationId || "default");
    const history = conversation.turns
      .filter((turn) => assistantHistoryMatchesTarget(turn, target))
      .filter((turn) => context.goalMode
        ? Boolean(context.goalRunId) && turn.goalRunId === context.goalRunId
        : !turn.goalMode && !turn.goalRunId)
      .slice(-MODEL_HISTORY_TURNS)
      .map((turn) => ({ request: turn.request, answer: turn.answer }));
    const { content } = await runTagAgent(source.key, model, request, context, 6, {
      // 每步实时写入 job，客户端轮询立即能看到检索轨迹。
      onStep: (step) => {
        job.steps.push(step);
      },
      onUsage: (usage) => { job.usage.push(usage); },
      images,
      history,
      reasoningEffort: context.reasoningEffort,
      signal: jobSignal,
      baseUrl: source.baseUrl,
      transport: source.transport,
      refreshKey: source.refreshKey,
    });
    const suggestion = adaptAssistantSuggestion(parseTagSuggestion(content), target);
    const candidates = target.capabilities.promptStyle === "tags" ? [...new Set(suggestion.tags)] : [];
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
        imageModel: target.imageModel,
        modelProtocol: target.modelProtocol,
        promptStyle: target.capabilities.promptStyle,
        ...(suggestion.message ? { message: suggestion.message } : {}),
        ...(suggestion.englishDescription
          ? { englishDescription: suggestion.englishDescription }
          : {}),
        prompt: mergeTagsIntoPrompt(suggestion.prompt, validTags),
        negativePrompt: suggestion.negativePrompt,
        parameters: suggestion.parameters,
        ...(suggestion.characters ? { characters: suggestion.characters } : {}),
        ...(typeof suggestion.goalComplete === "boolean" ? { goalComplete: suggestion.goalComplete } : {}),
        tags: validTags,
      },
      rejectedTags: results
        .filter((item) => item.result.status === "rejected")
        .map((item) => item.candidate),
      unverifiedTags: results
        .filter((item) => item.result.status === "unavailable")
        .map((item) => item.candidate),
    };
    await refreshAssistantJobUsage(job, true);
    jobSignal.throwIfAborted();

    // 落盘本轮对话；失败不影响返回结果（下次对话少一段历史而已）。
    try {
      const turn: ConversationTurn = {
        id: job.id,
        request,
        answer: JSON.stringify({
          ...suggestion,
          characters: suggestion.characters?.map((character) => ({
            prompt: character.prompt,
            center: { x: character.centerX, y: character.centerY },
          })),
          prompt: job.result.suggestion.prompt,
          tags: job.result.suggestion.tags.map((tag) => tag.name),
        }),
        imageModel: target.imageModel,
        modelProtocol: target.modelProtocol,
        createdAt: new Date().toISOString(),
        ...(context.goalMode ? { goalMode: true, ...(context.goalRunId ? { goalRunId: context.goalRunId } : {}) } : {}),
        ...(suggestion.message ? { message: suggestion.message } : {}),
        ...(suggestion.englishDescription
          ? { englishDescription: suggestion.englishDescription }
          : {}),
        prompt: job.result.suggestion.prompt,
        negativePrompt: job.result.suggestion.negativePrompt,
        parameters: job.result.suggestion.parameters,
        tags: job.result.suggestion.tags as ConversationTag[],
        rejectedTags: job.result.rejectedTags,
        unverifiedTags: job.result.unverifiedTags,
        steps: job.steps,
        usage: job.usage,
      };
      await appendConversationTurn(userId, turn, job.conversationId || "default", jobSignal);
    } catch (error) {
      if (jobSignal.aborted) throw error;
      // 普通持久化失败不丢弃已经生成的结果。
    }
    jobSignal.throwIfAborted();
    job.status = "done";
  } catch (error) {
    await refreshAssistantJobUsage(job, true);
    if (assistantJobSignal(job).aborted) { job.status = "cancelled"; job.message = "已取消助手任务"; return; }
    if (error instanceof AssistantModelBlockedError) job.error = error.info;
    job.message = jobSignal.aborted
      ? "助手处理超过时限，请减少标签数量后重试。"
      : error instanceof Error ? error.message : "智能标签助手调用失败";
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
  if (typeof body.model !== "string" || !isAssistantChatModel(body.model))
    return NextResponse.json(
      { message: "请选择一个文本对话模型" },
      { status: 400 },
    );
  let target: AssistantImageTarget;
  let reasoningEffort: string | undefined;
  try {
    target = resolveAssistantImageTarget(body);
    reasoningEffort = resolveAssistantReasoning(body.model, body.reasoningEffort);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "图像目标无效" },
      { status: 400 },
    );
  }
  if (
    typeof body.request !== "string" ||
    !body.request.trim() ||
    body.request.length > ASSISTANT_INPUT_MAX_LENGTH
  )
    return NextResponse.json(
      { message: "请输入不超过 10000 字的创作需求" },
      { status: 400 },
    );
  if (body.goalMode !== undefined && typeof body.goalMode !== "boolean")
    return NextResponse.json({ message: "goalMode 必须是布尔值" }, { status: 400 });
  if (body.goalRunId !== undefined && (typeof body.goalRunId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(body.goalRunId)))
    return NextResponse.json({ message: "目标会话 ID 无效" }, { status: 400 });
  if (body.accessMode !== undefined && body.accessMode !== "approval" && body.accessMode !== "full")
    return NextResponse.json({ message: "Agent 权限模式无效" }, { status: 400 });
  if (body.goalMode === true && (typeof body.goal !== "string" || !body.goal.trim() || body.goal.length > ASSISTANT_INPUT_MAX_LENGTH))
    return NextResponse.json({ message: "目标 Agent 需要不超过 10000 字的明确目标" }, { status: 400 });
  if (body.goalMaxRounds !== undefined && !validGoalGenerations(body.goalMaxRounds))
    return NextResponse.json({ message: `自动生成轮次必须为 1～${MAX_GOAL_GENERATIONS} 的整数` }, { status: 400 });
  if (body.goalIteration !== undefined && (typeof body.goalIteration !== "number" || !Number.isInteger(body.goalIteration) || body.goalIteration < 0 || body.goalIteration > MAX_GOAL_GENERATIONS ||
      (body.accessMode === "full" && body.goalIteration > (typeof body.goalMaxRounds === "number" ? body.goalMaxRounds : DEFAULT_GOAL_GENERATIONS))))
    return NextResponse.json({ message: "Agent 轮次超出范围" }, { status: 400 });
  if (body.localTags !== undefined && (
    !Array.isArray(body.localTags) || body.localTags.length > 256 ||
    body.localTags.some((tag) => typeof tag !== "string" || tag.length > 120)
  )) return NextResponse.json({ message: "localTags 必须为最多 256 个候选标签的数组" }, { status: 400 });

  if ([body.currentPrompt, body.currentNegativePrompt].some(value => value !== undefined && (typeof value !== "string" || value.length > 40_000)))
    return NextResponse.json({ message: "助手读取的当前正向或负向提示词必须为不超过 40000 字符的文本，请精简后重试" }, { status: 400 });
  if (body.allowWikipedia !== undefined && typeof body.allowWikipedia !== "boolean") return NextResponse.json({ message: "百科检索权限必须是布尔值" }, { status: 400 });
  const conversationId = body.conversationId ?? "default";
  if (!isAssistantConversationId(conversationId)) return NextResponse.json({ message: "会话 ID 无效" }, { status: 400 });
  try { await readConversation(session.userId, conversationId); }
  catch { return NextResponse.json({ message: "会话不存在或已删除" }, { status: 404 }); }
  let creativeMemory: AssistantCreativeMemory[] | undefined;
  if (body.creativeMemory !== undefined) {
    try { creativeMemory = parseAssistantCreativeMemory(body.creativeMemory); }
    catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "创作记忆无效" }, { status: 400 }); }
  }

  if (body.historyIds !== undefined && !Array.isArray(body.historyIds))
    return NextResponse.json(
      { message: "historyIds 必须是数组" },
      { status: 400 },
    );
  if (body.images !== undefined && !Array.isArray(body.images))
    return NextResponse.json(
      { message: "images 必须是数组" },
      { status: 400 },
    );
  const requestedImageCount =
    (Array.isArray(body.historyIds) ? body.historyIds.length : 0) +
    (Array.isArray(body.images) ? body.images.length : 0) +
    (body.image === undefined ? 0 : 1);
  if (requestedImageCount > MAX_ASSISTANT_IMAGES)
    return NextResponse.json(
      { message: "最多只能分析 10 张图片" },
      { status: 400 },
    );
  if (body.image !== undefined && !validDataImage(body.image))
    return NextResponse.json(
      { message: "image 必须是 8MB 以内的 PNG、JPEG 或 WEBP data URL" },
      { status: 400 },
    );
  if (
    Array.isArray(body.images) &&
    body.images.some((image) => !validDataImage(image))
  )
    return NextResponse.json(
      { message: "images 只能包含 8MB 以内的 PNG、JPEG 或 WEBP data URL" },
      { status: 400 },
    );
  if (
    Array.isArray(body.historyIds) &&
    body.historyIds.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id),
    )
  )
    return NextResponse.json(
      { message: "historyIds 包含不合法的历史 ID" },
      { status: 400 },
    );

  try {
    const directImages = [
      ...(Array.isArray(body.images) ? (body.images as string[]) : []),
      ...(typeof body.image === "string" ? [body.image] : []),
    ];
    const historyResult = await readHistoryImages(
      session.userId,
      body.historyIds,
    );
    if (historyResult.invalid)
      return NextResponse.json(
        { message: "部分 historyIds 不存在、不可访问或图片不受支持" },
        { status: 400 },
      );
    const historyImages = historyResult.images;
    const images = [...directImages, ...historyImages].slice(
      0,
      MAX_ASSISTANT_IMAGES,
    );
    const estimatedTotalBytes = images.reduce(
      (total, image) => total + Math.ceil((image.length * 3) / 4),
      0,
    );
    if (estimatedTotalBytes > MAX_ASSISTANT_TOTAL_IMAGE_BYTES)
      return NextResponse.json(
        { message: "图片总大小不能超过 24MB" },
        { status: 400 },
      );
    const source = await resolveAssistantSource(session, body.model, body.assistantProviderId, body.assistantGroup);
    const job = createAssistantJob(session.userId, conversationId);
    void runJob(
      job,
      session,
      source,
      body.model,
      body.request,
      {
        currentPrompt: body.currentPrompt,
        reasoningEffort,
        allowWikipedia: body.allowWikipedia !== false,
        currentNegativePrompt: body.currentNegativePrompt,
        ...(creativeMemory?.length ? { creativeMemory } : {}),
        imageModel: target.imageModel,
        modelProtocol: target.modelProtocol,
        operation: target.operation,
        ...(body.goalMode === true ? {
          goalMode: true,
          accessMode: body.accessMode === "full" ? "full" as const : "approval" as const,
          goal: String(body.goal),
          goalIteration: typeof body.goalIteration === "number" ? body.goalIteration : 0,
          goalMaxRounds: typeof body.goalMaxRounds === "number" ? body.goalMaxRounds : DEFAULT_GOAL_GENERATIONS,
          ...(typeof body.goalRunId === "string" ? { goalRunId: body.goalRunId } : {}),
        } : {}),
        ...(Array.isArray(body.localTags) ? { localTags: body.localTags as string[] } : {}),
      },
      images,
      target,
    );
    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "智能标签助手调用失败",
      },
      { status: error instanceof AssistantSourceError ? 400 : 502 },
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
  const jobId = url.searchParams.get("job");
  // 无 job 参数：返回持久化对话（历史轮次 + 累积标签池）。
  if (!jobId) {
    const conversationId = url.searchParams.get("conversationId") ?? "default";
    if (!isAssistantConversationId(conversationId)) return NextResponse.json({ message: "会话 ID 无效" }, { status: 400 });
    let conversation;
    try { conversation = await readConversation(session.userId, conversationId); }
    catch { return NextResponse.json({ message: "会话不存在或已删除" }, { status: 404 }); }
    return NextResponse.json({
      turns: [...conversation.turns].reverse(),
      tagPool: conversation.tagPool,
    });
  }
  const job = findAssistantJob(session.userId, jobId);
  if (!job)
    return NextResponse.json(
      { message: "任务不存在或已过期，请重新发起" },
      { status: 404 },
    );
  await refreshAssistantJobUsage(job);
  if (job.status === "cancelled") return NextResponse.json({ status: "cancelled", message: job.message, steps: job.steps, usage: job.usage });
  if (job.status === "running")
    return NextResponse.json({ status: "running", steps: job.steps, usage: job.usage });
  if (job.status === "error")
    return NextResponse.json(
      { status: "error", message: job.message, error: job.error, steps: job.steps, usage: job.usage },
      { status: 200 },
    );
  return NextResponse.json({ status: "done", steps: job.steps, ...job.result, usage: job.usage });
}

// 清空当前用户的助手对话记录（历史轮次 + 累积标签池）。
export async function DELETE(request?: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后使用智能标签助手", sessionExpired: true },
      { status: 401 },
    );
  try {
    const jobId = request ? new URL(request.url).searchParams.get("job") : null;
    if (request && new URL(request.url).searchParams.has("job") && !jobId) return NextResponse.json({ message: "任务 ID 不能为空" }, { status: 400 });
    if (jobId) {
      const job = findAssistantJob(session.userId, jobId);
      if (!job || !cancelAssistantJob(session.userId, jobId)) return NextResponse.json({ message: "任务不存在或已过期" }, { status: 404 });
      await refreshAssistantJobUsage(job, true);
      return NextResponse.json({ success: true, status: job.status });
    }
    const conversationId = request ? new URL(request.url).searchParams.get("conversationId") ?? "default" : "default";
    if (!isAssistantConversationId(conversationId)) return NextResponse.json({ message: "会话 ID 无效" }, { status: 400 });
    try { await readConversation(session.userId, conversationId); } catch { return NextResponse.json({ message: "会话不存在或已删除" }, { status: 404 }); }
    cancelConversationJobs(session.userId, conversationId);
    await clearConversation(session.userId, conversationId);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ message: "对话记录清空失败" }, { status: 500 });
  }
}
