// 内联聊天任务：与 assistant-jobs 相同的内存 job + 轮询模式，
// 但结果是纯文本（选中内容的改写/回答），无标签校验管线。
export type InlineChatJob = {
  id: string;
  userId: number;
  createdAt: number;
  status: "running" | "done" | "error";
  text?: string;
  message?: string;
};

type JobStore = { __lfnInlineChatJobs?: Map<string, InlineChatJob> };
const globalStore = globalThis as typeof globalThis & JobStore;
const jobs: Map<string, InlineChatJob> = (globalStore.__lfnInlineChatJobs ??=
  new Map());

const JOB_TTL_MS = 10 * 60_000;
const JOB_LIMIT = 200;

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
  while (jobs.size >= JOB_LIMIT) {
    const oldest = [...jobs.values()].sort(
      (a, b) => a.createdAt - b.createdAt,
    )[0];
    if (!oldest) break;
    jobs.delete(oldest.id);
  }
}

export function createInlineChatJob(userId: number): InlineChatJob {
  pruneJobs();
  const job: InlineChatJob = {
    id: crypto.randomUUID(),
    userId,
    createdAt: Date.now(),
    status: "running",
  };
  jobs.set(job.id, job);
  return job;
}

// 只允许创建者读取；不存在/过期/他人任务统一返回 null。
export function findInlineChatJob(
  userId: number,
  id: string,
): InlineChatJob | null {
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return null;
  if (Date.now() - job.createdAt > JOB_TTL_MS) {
    jobs.delete(id);
    return null;
  }
  return job;
}
