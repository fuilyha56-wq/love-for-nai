import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { deleteStory, findStory, updateStory, type StoryPatch } from "@/lib/stories";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录后使用故事工作台" }, { status: 401 });
  const story = await findStory(session.userId, (await context.params).id);
  return story
    ? NextResponse.json({ story })
    : NextResponse.json({ message: "故事不存在" }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录后保存故事" }, { status: 401 });
  let body: StoryPatch;
  try {
    body = await parseJsonBody<StoryPatch>(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  try {
    const story = await updateStory(session.userId, (await context.params).id, body);
    return NextResponse.json({ story });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存故事失败";
    return NextResponse.json({ message }, { status: message === "故事不存在" ? 404 : 400 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录后删除故事" }, { status: 401 });
  const removed = await deleteStory(session.userId, (await context.params).id);
  return removed
    ? NextResponse.json({ success: true })
    : NextResponse.json({ message: "故事不存在" }, { status: 404 });
}