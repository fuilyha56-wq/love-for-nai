import { runTool, toolSchemas } from "@/lib/agent-tools";
import { newApiBaseUrl } from "@/lib/newapi";

type ToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};
type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  // Gemini 经 NewAPI 转换时要求 tool 结果携带函数名，缺失会返回 400。
  name?: string;
};
type ChatResponse = {
  choices?: Array<{ message?: Message; finish_reason?: string }>;
  error?: { message?: string };
};

export type AgentStep = { tool: string; query: string; ok: boolean };

export const TAG_AGENT_LIMITS = {
  maxRounds: 6,
  maxCallsPerRound: 8,
  maxTotalCalls: 24,
  maxDurationMs: 150_000,
  maxModelCallMs: 90_000,
} as const;

const SYSTEM_PROMPT = `你是 NovelAI 提示词 agent。目标是把用户需求转成经 Danbooru 验证的英文标签。

工作方式：
1. 拆解需求为若干视觉概念（人物、发色、服饰、场景、光照、构图等）。
2. 中文或小众概念先用 web_search 查证通用英文说法，再用 search_danbooru_tags 检索。
3. 用 search_danbooru_tags 找候选标签；不确定含义时用 read_danbooru_wiki 确认；最终标签用 verify_danbooru_tag 校验存在性。
4. 优先选图片数较多的通用标签，避免生僻或已废弃标签。

允许多轮调用工具，直到收集到足够标签。完成后只输出 JSON，不要 Markdown：
{"prompt":"逗号分隔的完整提示词","negativePrompt":"负面提示词","tags":["tag_1","tag_2"],"parameters":{"width":832,"height":1216,"steps":28,"scale":5,"sampler":"k_euler_ancestral","noiseSchedule":"karras"}}

tags 只能包含已通过工具确认存在的标签。parameters 可省略字段。`;

async function callModel(
  baseUrl: string,
  key: string,
  model: string,
  messages: Message[],
  withTools: boolean,
  deadline: number,
): Promise<Message> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("标签助手执行超时，请缩短需求后重试");
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.3,
      messages,
      ...(withTools ? { tools: toolSchemas, tool_choice: "auto" } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(
      Math.max(1, Math.min(TAG_AGENT_LIMITS.maxModelCallMs, remaining)),
    ),
  });
  const result = (await response.json()) as ChatResponse;
  if (!response.ok || result.error)
    throw new Error(result.error?.message || "模型助手调用失败");
  const message = result.choices?.[0]?.message;
  if (!message) throw new Error("模型未返回内容");
  return message;
}

function describeCall(call: ToolCall): {
  name: string;
  args: Record<string, unknown>;
} {
  const name = call.function?.name || "";
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function?.arguments || "{}") as Record<
      string,
      unknown
    >;
  } catch {
    args = {};
  }
  return { name, args };
}

export async function runTagAgent(
  key: string,
  model: string,
  userRequest: string,
  context: { currentPrompt?: string; currentNegativePrompt?: string },
): Promise<{ content: string; steps: AgentStep[] }> {
  const baseUrl = newApiBaseUrl();
  const deadline = Date.now() + TAG_AGENT_LIMITS.maxDurationMs;
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        request: userRequest,
        currentPrompt: context.currentPrompt || "",
        currentNegativePrompt: context.currentNegativePrompt || "",
      }),
    },
  ];
  const steps: AgentStep[] = [];

  let totalCalls = 0;
  for (let round = 0; round < TAG_AGENT_LIMITS.maxRounds; round += 1) {
    const message = await callModel(
      baseUrl,
      key,
      model,
      messages,
      true,
      deadline,
    );
    const calls = message.tool_calls ?? [];
    if (!calls.length) return { content: message.content || "", steps };
    if (calls.length > TAG_AGENT_LIMITS.maxCallsPerRound)
      throw new Error("模型一次请求了过多检索工具，请简化需求后重试");
    if (totalCalls + calls.length > TAG_AGENT_LIMITS.maxTotalCalls)
      throw new Error("标签助手检索次数已达上限，请简化需求后重试");
    if (Date.now() >= deadline)
      throw new Error("标签助手执行超时，请缩短需求后重试");
    totalCalls += calls.length;

    messages.push(message);
    const toolResults = await Promise.all(
      calls.map(async (call) => {
        const { name, args } = describeCall(call);
        const result = await runTool(name, args);
        return { call, name, args, result };
      }),
    );
    for (const { call, name, args, result } of toolResults) {
      steps.push({
        tool: name,
        query: String(args.query ?? args.name ?? args.title ?? ""),
        ok: result.ok,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name,
        content: JSON.stringify(result.data),
      });
    }
  }

  // 轮次用尽时收口，要求模型基于已有工具结果直接给出 JSON。
  messages.push({
    role: "user",
    content: "工具调用已达上限，请基于已确认的标签立即输出最终 JSON。",
  });
  const final = await callModel(baseUrl, key, model, messages, false, deadline);
  return { content: final.content || "", steps };
}
