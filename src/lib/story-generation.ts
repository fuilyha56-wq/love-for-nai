import { getStoryToken, resolvedNewApiBaseUrl, type Session } from "@/lib/newapi";
import {
  fetchWithModelConcurrency,
  withModelConcurrencySlot,
} from "@/lib/model-concurrency";
import type { Story, StoryBranch } from "@/lib/stories";
import { findStoryProvider } from "@/lib/story-providers";
import { validateStoryProviderUrl } from "@/lib/story-provider-network";

export const STORY_GENERATION_MODES = ["continue", "rewrite", "insert"] as const;
export type StoryGenerationMode = (typeof STORY_GENERATION_MODES)[number];

type GenerateInput = {
  mode: StoryGenerationMode;
  instruction: string;
  content: string;
  selectionStart: number;
  selectionEnd: number;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
  message?: string;
};

const NOVEL_SYSTEM_PROMPT = `你是面向长篇小说创作的中文写作模型。保持人物动机、叙事视角、时态、语气和世界设定连续；用具体动作、感官与对话推进情节，避免总结式写法、套路化收束和解释创作过程。只输出可直接写入正文的小说文本，不输出标题、前言、分析、Markdown 或引号。`;
const PLAIN_SYSTEM_PROMPT = `根据用户提供的上下文执行写作指令。只输出可直接写入正文的文本，不解释过程，不使用 Markdown。`;
const MAX_CONTEXT_CHARS = 60_000;
const MAX_INSTRUCTION_CHARS = 2_000;
const MAX_GENERATED_CHARS = 80_000;

export const withStoryGenerationSlot = withModelConcurrencySlot;

function boundedSelection(input: GenerateInput): { start: number; end: number } {
  const start = Math.min(input.content.length, Math.max(0, Math.floor(input.selectionStart)));
  const end = Math.min(input.content.length, Math.max(start, Math.floor(input.selectionEnd)));
  return { start, end };
}

export function applyStoryGeneration(input: GenerateInput, generated: string): string {
  const text = generated.trim().slice(0, MAX_GENERATED_CHARS);
  const { start, end } = boundedSelection(input);
  if (input.mode === "rewrite") return `${input.content.slice(0, start)}${text}${input.content.slice(end)}`;
  if (input.mode === "insert") return `${input.content.slice(0, start)}${text}${input.content.slice(start)}`;
  if (!input.content) return text;
  const separator = /\s$/.test(input.content) || /^\s/.test(text) ? "" : "\n\n";
  return `${input.content}${separator}${text}`;
}

function buildUserPrompt(story: Story, branch: StoryBranch, input: GenerateInput): string {
  const { start, end } = boundedSelection(input);
  const selected = input.content.slice(start, end);
  const context = input.content.slice(-MAX_CONTEXT_CHARS);
  const action = input.mode === "continue"
    ? "从正文结尾自然续写"
    : input.mode === "rewrite"
      ? "改写选中的正文片段，保持前后衔接"
      : "在光标位置插入正文，保持前后衔接";
  return [
    `任务：${action}`,
    `作品：${story.title}`,
    story.genre ? `类型：${story.genre}` : "",
    story.synopsis ? `故事概要：${story.synopsis}` : "",
    story.lorebook ? `设定资料：${story.lorebook}` : "",
    `当前分支：${branch.name}`,
    input.instruction ? `本次指令：${input.instruction.slice(0, MAX_INSTRUCTION_CHARS)}` : "本次指令：延续当前情节与文风",
    selected ? `选中片段：\n${selected}` : "",
    `正文上下文：\n${context}`,
  ].filter(Boolean).join("\n\n");
}

function readUpstreamError(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as ChatResponse;
    return parsed.error?.message || parsed.message || text || `HTTP ${status}`;
  } catch {
    return text || `HTTP ${status}`;
  }
}

export async function generateStoryText(
  session: Session,
  story: Story,
  branch: StoryBranch,
  input: GenerateInput,
): Promise<string> {
  const providerId = story.model.startsWith("custom:") ? story.model.slice(7) : "";
  const provider = providerId ? await findStoryProvider(session.userId, providerId) : null;
  if (providerId && !provider) throw new Error("模型源已删除，请在故事设置中选择其他模型");
  const model = provider?.model || story.model.replace(/^newapi:/, "");
  const baseUrl = provider?.kind === "openai"
    ? await validateStoryProviderUrl(provider.baseUrl)
    : await resolvedNewApiBaseUrl();
  const key = provider?.secret || await getStoryToken(session, model);
  const endpoint = provider?.kind === "novelai"
    ? "https://text.novelai.net/ai/generate"
    : `${baseUrl}${baseUrl.endsWith("/v1") ? "" : "/v1"}/chat/completions`;
  const system = story.specializedPrompt ? NOVEL_SYSTEM_PROMPT : PLAIN_SYSTEM_PROMPT;
  const prompt = buildUserPrompt(story, branch, input);
  const response = await fetchWithModelConcurrency(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(provider?.kind === "novelai" ? {
          input: `[System: ${system}]\nUser: ${prompt}\nAssistant:`,
          model,
          parameters: { use_string: true, temperature: 0.8, max_length: 1800, min_length: 1, top_p: 0.9, top_k: 3, repetition_penalty: 1.05 },
        } : {
          model,
          stream: false,
          temperature: model === "luna" ? 0.9 : 0.72,
          max_tokens: 1800,
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        }),
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${provider?.name || `ikun/${model}`} 返回 ${response.status}: ${readUpstreamError(text, response.status).slice(0, 4_000)}`);
    }
    let result: ChatResponse;
    try {
      result = JSON.parse(text) as ChatResponse;
    } catch {
      throw new Error(`${model} 返回了无法解析的响应: ${text.slice(0, 1_000)}`);
    }
    const content = (provider?.kind === "novelai" ? (result as ChatResponse & { output?: string }).output : result.choices?.[0]?.message?.content)?.trim();
    if (!content) throw new Error(`${model} 未返回正文内容`);
  return content;
}