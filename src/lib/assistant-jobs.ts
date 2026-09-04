import { randomUUID } from "node:crypto";
import type { AgentStep } from "@/lib/tag-agent";

// 助手任务存内存：单容器部署下进程常驻，重启丢失可接受（客户端提示重试）。
// 用轮询代替一次长连接，避免移动端 WebView 在长等待中掐断请求。
export type AssistantJobResult = {
  suggestion: {
    // 助手对用户说的自然语言（final.message），缺省表示本轮没有留言。
    message?: string;
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
  createdAt: number;
  status: "running" | "done" | "error";
  steps: AgentStep[];
  result?: AssistantJobResult;
  message?: string;
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
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
  while (jobs.size >= JOB_LIMIT) {
    const oldest = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) break;
    jobs.delete(oldest.id);
  }
}

export function createAssistantJob(userId: number): AssistantJob {
  pruneJobs();
  const job: AssistantJob = {
    id: randomUUID(),
    userId,
    createdAt: Date.now(),
    status: "running",
    steps: [],
  };
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
  if (Date.now() - job.createdAt > JOB_TTL_MS) {
    jobs.delete(id);
    return null;
  }
  return job;
}
