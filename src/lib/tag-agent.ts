import { runTool, summarizeToolResult, toolCatalog } from "@/lib/agent-tools";
import { newApiBaseUrl } from "@/lib/newapi";

type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

type Message = {
  role: "system" | "user" | "assistant";
  content: MessageContent;
};
type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

export type AgentStep = {
  tool: string;
  query: string;
  ok: boolean;
  summary?: string;
};

// 文本协议避免 NewAPI 将 OpenAI tool 消息转换为 Gemini function_response 时的兼容性错误。
const SYSTEM_PROMPT = `你是 NovelAI 提示词 agent。目标是把用户需求转成经 Danbooru 验证的英文标签。

可用工具：
${toolCatalog()}

工作方式：
1. 拆解需求为若干视觉概念（人物、发色、服饰、场景、光照、构图等）。
2. 用户消息附带参考图片时，先仔细读图：人物特征、发型发色、服饰配饰、表情动作、场景构图、画风质感，再把这些转成候选英文标签检索。
3. 中文或小众概念先用 web_search 查证通用英文说法，再用 search_danbooru_tags 检索。
4. 用 search_danbooru_tags 找候选标签；不确定含义时用 read_danbooru_wiki 确认；最终标签用 verify_danbooru_tag 校验存在性。
5. 优先选图片数较多的通用标签，避免生僻或已废弃标签。

这是一次延续对话：消息历史中包含此前轮次的需求与最终 JSON 结论。
延续对话时参考已确认的标签，不要重复检索相同的标签，除非用户要求重新验证。

每次回复只能输出一个 JSON 对象，不要 Markdown 或解释文字。
调用工具时输出：
{"action":"工具名","args":{"参数名":"参数值"}}

完成后输出：
{"final":{"prompt":"逗号分隔的完整提示词","negativePrompt":"负面提示词","tags":["tag_1","tag_2"],"parameters":{"width":832,"height":1216,"steps":28,"scale":5,"sampler":"k_euler_ancestral","noiseSchedule":"karras"}}}

tags 只能包含已通过工具确认存在的标签。parameters 可省略字段。`;

async function callModel(
  baseUrl: string,
  key: string,
  model: string,
  messages: Message[],
): Promise<string> {
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
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  const result = (await response.json()) as ChatResponse;
  if (!response.ok || result.error)
    throw new Error(result.error?.message || "模型助手调用失败");
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型未返回内容");
  return content;
}

type AgentDecision =
  | { kind: "action"; name: string; args: Record<string, unknown> }
  | { kind: "final"; content: string }
  | { kind: "invalid" };

function parseDecision(content: string): AgentDecision {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return { kind: "invalid" };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { kind: "invalid" };
  }
  if (parsed.final && typeof parsed.final === "object")
    return { kind: "final", content: JSON.stringify(parsed.final) };
  if (typeof parsed.action === "string")
    return {
      kind: "action",
      name: parsed.action,
      args:
        parsed.args && typeof parsed.args === "object"
          ? (parsed.args as Record<string, unknown>)
          : {},
    };
  // 兼容部分模型省略 final 包装层的情况。
  if (parsed.prompt || parsed.tags)
    return { kind: "final", content: JSON.stringify(parsed) };
  return { kind: "invalid" };
}

export async function runTagAgent(
  key: string,
  model: string,
  userRequest: string,
  context: { currentPrompt?: string; currentNegativePrompt?: string },
  maxRounds = 8,
  options?: {
    onStep?: (step: AgentStep) => void;
    image?: string;
    // 之前轮次的 {需求, 最终 JSON}，注入为 user/assistant 消息对，
    // 让模型带着历史上下文延续对话。
    history?: Array<{ request: string; answer: string }>;
  },
): Promise<{ content: string; steps: AgentStep[] }> {
  const baseUrl = newApiBaseUrl();
  const requestText = JSON.stringify({
    request: userRequest,
    currentPrompt: context.currentPrompt || "",
    currentNegativePrompt: context.currentNegativePrompt || "",
    hasImage: Boolean(options?.image),
  });
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    // 附图时首条消息用多模态内容；OpenAI 兼容格式由 NewAPI 转换。
    options?.image
      ? {
          role: "user",
          content: [
            { type: "text", text: requestText },
            { type: "image_url", image_url: { url: options.image } },
          ],
        }
      : { role: "user", content: requestText },
  ];
  // 历史对话插在系统提示之后、本轮请求之前，模型可查看之前的上下文并延续结论。
  const historyBase = 1;
  for (const turn of options?.history ?? []) {
    if (!turn.request || !turn.answer) continue;
    messages.splice(historyBase, 0, {
      role: "user",
      content: JSON.stringify({
        request: turn.request,
        currentPrompt: "",
        currentNegativePrompt: "",
        hasImage: false,
      }),
    });
    messages.splice(historyBase + 1, 0, {
      role: "assistant",
      content: turn.answer,
    });
  }
  const steps: AgentStep[] = [];

  for (let round = 0; round < maxRounds; round += 1) {
    const content = await callModel(baseUrl, key, model, messages);
    const decision = parseDecision(content);
    if (decision.kind === "final") return { content: decision.content, steps };

    messages.push({ role: "assistant", content });
    if (decision.kind === "invalid") {
      messages.push({
        role: "user",
        content: "回复格式无效。请只输出 action 或 final 的 JSON 对象。",
      });
      continue;
    }

    const result = await runTool(decision.name, decision.args);
    const step: AgentStep = {
      tool: decision.name,
      query: String(
        decision.args.query ?? decision.args.name ?? decision.args.title ?? "",
      ),
      ok: result.ok,
      summary: summarizeToolResult(decision.name, result.data),
    };
    steps.push(step);
    // 每步实时上报，轮询方能立即看到检索过程。
    options?.onStep?.(step);
    messages.push({
      role: "user",
      content: JSON.stringify({
        tool: decision.name,
        ok: result.ok,
        result: result.data,
      }),
    });
  }

  // 轮次用尽时收口，要求模型基于已有工具结果直接给出 JSON。
  messages.push({
    role: "user",
    content: "工具调用已达上限，请基于已确认的标签立即输出最终 JSON。",
  });
  const final = await callModel(baseUrl, key, model, messages);
  const decision = parseDecision(final);
  return {
    content: decision.kind === "final" ? decision.content : final,
    steps,
  };
}
