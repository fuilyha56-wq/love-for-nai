import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { findAssistantJob } from "@/lib/assistant-jobs";
import { assistantImageReceipt, refreshAssistantJobUsage } from "@/lib/assistant-usage-billing";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  let body: { jobs?: unknown; images?: unknown };
  try { body = await parseJsonBody(request); } catch (error) { return invalidJsonResponse(error); }
  const valid = (ids: unknown) => ids === undefined || (Array.isArray(ids) && ids.length <= 101 && ids.every(id => typeof id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(id)));
  if (!valid(body.jobs) || !valid(body.images)) return NextResponse.json({ message: "用量请求编号无效" }, { status: 400 });
  const jobs: Record<string, unknown> = {};
  // Sequential queries keep an automatic run from flooding the shared DB pool.
  for (const id of new Set((body.jobs ?? []) as string[])) {
    const job = findAssistantJob(session.userId, id);
    if (!job) continue;
    await refreshAssistantJobUsage(job);
    jobs[id] = { status: job.status, usage: job.usage };
  }
  const images = [];
  for (const id of new Set((body.images ?? []) as string[])) {
    const receipt = await assistantImageReceipt(session.userId, id);
    if (receipt) images.push(receipt);
  }
  return NextResponse.json({ jobs, images }, { headers: { "Cache-Control": "private, no-store" } });
}
