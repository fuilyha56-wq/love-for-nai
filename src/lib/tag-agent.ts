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
};
type ChatResponse = {
  choices?: Array<{ message?: Message; finish_reason?: string }>;
  error?: { message?: string };
};

export type AgentStep = { tool: string; query: string; ok: boolean };

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
): Promise<Message> {
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
    signal: AbortSignal.timeout(90_000),
  });
  const result = (await response.json()) as ChatResponse;
  if (!response.ok || result.error)
    throw new Error(result.error?.message || "模型助手调用失败");
  const message = result.choices?.[0]?.message;
  if (!message) throw new Error("模型未返回内容");
  return message;
}

function describeCall(call: ToolCall): { name: string; args: Record<string, unknown> } {
  const name = call.function?.name || "";
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function?.arguments || "{}") as Record<string, unknown>;
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
  maxRounds = 6,
): Promise<{ content: string; steps: AgentStep[] }> {
  const baseUrl = newApiBaseUrl();
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

  for (let round = 0; round < maxRounds; round += 1) {
    const message = await callModel(baseUrl, key, model, messages, true);
    const calls = message.tool_calls ?? [];
    if (!calls.length) return { content: message.content || "", steps };

    messages.push(message);
    for (const call of calls) {
      const { name, args } = describeCall(call);
      const result = await runTool(name, args);
      steps.push({
        tool: name,
        query: String(args.query ?? args.name ?? args.title ?? ""),
        ok: result.ok,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result.data),
      });
    }
  }

  // 轮次用尽时收口，要求模型基于已有工具结果直接给出 JSON。
  messages.push({
    role: "user",
    content: "工具调用已达上限，请基于已确认的标签立即输出最终 JSON。",
  });
  const final = await callModel(baseUrl, key, model, messages, false);
  return { content: final.content || "", steps };
}
