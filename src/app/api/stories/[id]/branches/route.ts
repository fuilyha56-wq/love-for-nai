import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createStoryBranch } from "@/lib/stories";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录后创建分支" }, { status: 401 });
  let body: { sourceBranchId?: unknown; name?: unknown };
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  if (typeof body.sourceBranchId !== "string")
    return NextResponse.json({ message: "缺少源分支" }, { status: 400 });
  try {
    const story = await createStoryBranch(
      session.userId,
      (await params).id,
      body.sourceBranchId,
      typeof body.name === "string" ? body.name : undefined,
    );
    return NextResponse.json({ story }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "创建分支失败" }, { status: 400 });
  }
}