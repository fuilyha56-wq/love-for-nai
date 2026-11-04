import { randomUUID } from "node:crypto";
import type { AgentStep, TagAgentCheckpoint, runTagAgent } from "@/lib/tag-agent";
import type { ImageProviderProtocol } from "@/lib/image-model-capabilities";
import type { AssistantErrorInfo } from "@/lib/assistant-model-error";
import type { AssistantCallUsage } from "./assistant-usage";

// 助手任务存内存：单容器部署下进程常驻，重启丢失可接受（客户端提示重试）。
// 用轮询代替一次长连接，避免移动端 WebView 在长等待中掐断请求。
export type AssistantJobResult = {
  suggestion: {
    imageModel?: string;
    modelProtocol?: ImageProviderProtocol;
    promptStyle?: "tags" | "natural";
    // 助手对用户说的自然语言（final.message），缺省表示本轮没有留言。
    message?: string;
    // 1–3 句英文自然语言描述，不含 artist 信息。
    englishDescription?: string;
    prompt: string;
    negativePrompt: string;
    parameters: Record<string, unknown>;
    // 多角色建议：每角色独立提示词 + 画面中心坐标（无多角色时缺省）。
    characters?: Array<{
      prompt: string;
      centerX: number;
      centerY: number;
    }>;
    tags: Array<{
      name: string;
      displayName: string;
      categoryName: string;
      postCount: number;
    }>;
  };
  rejectedTags: string[];
  unverifiedTags: string[];
};

export type AssistantJob = {
  id: string;
  userId: number;
  conversationId?: string;
  createdAt: number;
  status: "running" | "done" | "error" | "cancelled" | "paused";
  active?: boolean;
  attempt?: number;
  updatedAt?: number;
  checkpoint?: TagAgentCheckpoint;
  input?: {
    model: string;
    request: string;
    providerId?: string;
    group?: string;
    context: Parameters<typeof runTagAgent>[3] & { reasoningEffort?: string };
    images: string[];
  };
  steps: AgentStep[];
  usage: AssistantCallUsage[];
  usageCheckedAt?: number;
  usageRefresh?: Promise<void>;
  result?: AssistantJobResult;
  message?: string;
  error?: AssistantErrorInfo;
};

type JobStore = { __lfnAssistantJobs?: Map<string, AssistantJob> };
const globalStore = globalThis as typeof globalThis & JobStore;
const jobs: Map<string, AssistantJob> = (globalStore.__lfnAssistantJobs ??=
  new Map());

const JOB_TTL_MS = 10 * 60_000;
const JOB_LIMIT = 100;

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - (job.updatedAt ?? job.createdAt) > JOB_TTL_MS) { abortAssistantJob(job, "助手任务已过期"); jobs.delete(id); }
  }
  while (jobs.size >= JOB_LIMIT) {
    const oldest = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) break;
    abortAssistantJob(oldest, "助手任务已被清理");
    jobs.delete(oldest.id);
  }
}

export function createAssistantJob(userId: number, conversationId = "default"): AssistantJob {
  pruneJobs();
  const job: AssistantJob = {
    id: randomUUID(),
    userId,
    createdAt: Date.now(),
    status: "running",
    steps: [],
    usage: [],
  };
  job.conversationId = conversationId;
  jobs.set(job.id, job);
  return job;
}

// 只允许创建者读取；不存在/过期/他人任务统一返回 null。
export function findAssistantJob(
  userId: number,
  id: string,
): AssistantJob | null {
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return null;
  if (Date.now() - (job.updatedAt ?? job.createdAt) > JOB_TTL_MS) {
    abortAssistantJob(job, "助手任务已过期"); jobs.delete(id); return null;
  }
  return job;
}

// Controllers stay server-only and survive development module reloads.
const cancellationStore = globalThis as typeof globalThis & { __lfnAssistantCancellation?: WeakMap<AssistantJob, AbortController> };
const jobControllers = (cancellationStore.__lfnAssistantCancellation ??= new WeakMap<AssistantJob, AbortController>());
export function assistantJobSignal(job: AssistantJob): AbortSignal {
  let controller = jobControllers.get(job);
  if (!controller) { controller = new AbortController(); jobControllers.set(job, controller); }
  return controller.signal;
}
export function canResumeAssistantJob(job: AssistantJob): boolean {
  return Boolean(job.input && job.checkpoint && !job.active && !job.error && ["paused", "cancelled", "error"].includes(job.status));
}

export function beginAssistantJob(job: AssistantJob): boolean {
  if (job.active) return false;
  job.active = true;
  job.attempt = (job.attempt ?? 0) + 1;
  job.status = "running";
  job.updatedAt = Date.now();
  job.message = undefined;
  jobControllers.set(job, new AbortController());
  return true;
}

export function finishAssistantJob(job: AssistantJob): void {
  job.active = false;
  job.updatedAt = Date.now();
  if (job.status === "done") { delete job.checkpoint; delete job.input; }
}

function abortAssistantJob(job: AssistantJob, message: string) {
  if (job.status !== "running") return;
  assistantJobSignal(job);
  job.status = "cancelled";
  job.message = message;
  jobControllers.get(job)!.abort(new DOMException(message, "AbortError"));
}
export function cancelAssistantJob(userId: number, id: string): boolean {
  const job = findAssistantJob(userId, id);
  if (!job) return false;
  abortAssistantJob(job, "已取消助手任务");
  return true;
}

export function cancelConversationJobs(userId: number, conversationId: string): number {
  let cancelled = 0;
  for (const job of jobs.values()) {
    if (job.userId !== userId || (job.conversationId || "default") !== conversationId) continue;
    if (job.status === "running") { abortAssistantJob(job, "会话已关闭或清空"); cancelled++; }
    delete job.input;
    delete job.checkpoint;
  }
  return cancelled;
}
