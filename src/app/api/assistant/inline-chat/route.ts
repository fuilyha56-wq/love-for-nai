import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getChatToken, resolvedNewApiBaseUrl } from "@/lib/newapi";
import { isKnownImageModel } from "@/lib/image-model-capabilities";
import { buildInlineAssistantPrompt, resolveAssistantImageTarget, type AssistantImageTarget } from "@/lib/assistant-model-prompts";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";
import { fetchWithModelConcurrency } from "@/lib/model-concurrency";
import {
  createInlineChatJob,
  findInlineChatJob,
  type InlineChatJob,
} from "@/lib/inline-chat-jobs";

// VSCode 内联聊天的 LFN 版：对选中文本的快速 AI 操作。
// 不带工具循环——单轮 chat completions，快进快出。

type InlinePayload = {
  model?: string;
  mode?: string;
  instruction?: string;
  selection?: string;
  contextBefore?: string;
  contextAfter?: string;
  imageModel?: unknown;
  targetImageModel?: unknown;
  modelProtocol?: unknown;
  operation?: unknown;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
  usage?: { total_tokens?: number };
};

// 各模式的小系统提示；fix/explain 对齐 VSCode 右键菜单语义，其余为通用改写。
const MODE_PROMPTS: Record<string, string> = {
  fix: "你是代码/文本修复助手。修复选中内容中的错误（错别字、语法、逻辑、标签格式），保持原有语言与格式约定。只输出修复后的完整结果，不要解释。",
  explain: "你是讲解助手。用简体中文简洁解释选中内容：它是什么、意图、关键点。不超过 150 字，不要复述原文。",
  polish: "你是润色助手。润色选中内容，使其更流畅自然，保持原意与语言。只输出润色后的完整结果，不要解释。",
  translate: "你是翻译助手。把选中内容翻译为英文（若原文已是英文则译为简体中文）。只输出译文。",
  custom: "你是提示词编辑助手。按用户的指令处理选中内容。只输出处理结果，不要解释。",
};

const MAX_SELECTION = 8000;
const MAX_CONTEXT = 2000;
const MAX_INSTRUCTION = 1000;

async function runJob(
  job: InlineChatJob,
  key: string,
  model: string,
  systemPrompt: string,
  userContent: string,
) {
  try {
    const baseUrl = await resolvedNewApiBaseUrl();
    const response = await fetchWithModelConcurrency(
      `${baseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          stream: false,
          temperature: 0.3,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      },
    );
    const result = (await response.json()) as ChatResponse;
    if (!response.ok || result.error)
      throw new Error(result.error?.message || "内联聊天调用失败");
    const content = result.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("模型未返回内容");
    job.text = content;
    job.status = "done";
  } catch (error) {
    job.status = "error";
    job.message = error instanceof Error ? error.message : "内联聊天调用失败";
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后使用内联聊天", sessionExpired: true },
      { status: 401 },
    );
  let body: InlinePayload;
  try {
    body = await parseJsonBody<InlinePayload>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  if (typeof body.model !== "string" || isKnownImageModel(body.model))
    return NextResponse.json(
      { message: "请选择一个文本对话模型" },
      { status: 400 },
    );
  let target: AssistantImageTarget;
  try {
    target = resolveAssistantImageTarget(body);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "图像目标无效" },
      { status: 400 },
    );
  }
  if (typeof body.selection !== "string" || !body.selection.trim())
    return NextResponse.json(
      { message: "请先选中要处理的内容" },
      { status: 400 },
    );
  if (body.selection.length > MAX_SELECTION)
    return NextResponse.json(
      { message: "选中内容过长（上限 8000 字）" },
      { status: 400 },
    );
  const mode =
    typeof body.mode === "string" && MODE_PROMPTS[body.mode]
      ? body.mode
      : "custom";
  if (mode === "custom") {
    if (
      typeof body.instruction !== "string" ||
      !body.instruction.trim() ||
      body.instruction.length > MAX_INSTRUCTION
    )
      return NextResponse.json(
        { message: "请输入要执行的操作（最多 1000 字）" },
        { status: 400 },
      );
  }
  const contextBefore =
    typeof body.contextBefore === "string"
      ? body.contextBefore.slice(-MAX_CONTEXT)
      : "";
  const contextAfter =
    typeof body.contextAfter === "string"
      ? body.contextAfter.slice(0, MAX_CONTEXT)
      : "";

  // 组装用户消息：上下文仅作定位参考，明确分隔选中内容。
  const userContent = [
    contextBefore ? `…前文：${contextBefore}` : "",
    "【选中内容开始】",
    body.selection,
    "【选中内容结束】",
    contextAfter ? `…后文：${contextAfter}` : "",
    mode === "custom" ? `\n指令：${body.instruction?.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const key = await getChatToken(session, body.model);
    const job = createInlineChatJob(session.userId);
    void runJob(job, key, body.model, buildInlineAssistantPrompt(MODE_PROMPTS[mode], target), userContent);
    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "内联聊天调用失败",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: "请先登录后使用内联聊天", sessionExpired: true },
      { status: 401 },
    );
  const jobId = new URL(request.url).searchParams.get("job");
  if (!jobId || jobId.length > 100)
    return NextResponse.json({ message: "缺少任务 ID" }, { status: 400 });
  const job = findInlineChatJob(session.userId, jobId);
  if (!job)
    return NextResponse.json(
      { message: "任务不存在或已过期" },
      { status: 404 },
    );
  if (job.status === "error")
    return NextResponse.json(
      { status: job.status, message: job.message },
      { status: 200 },
    );
  return NextResponse.json({ status: job.status, text: job.text });
}
