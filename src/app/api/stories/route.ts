import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createStory, listStories } from "@/lib/stories";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录后使用故事工作台" }, { status: 401 });
  return NextResponse.json({ items: await listStories(session.userId) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录后创建故事" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  try {
    const story = await createStory(session.userId, {
      title: typeof body.title === "string" ? body.title : undefined,
      model: body.model === "sol" || body.model === "luna" ? body.model : undefined,
      genre: typeof body.genre === "string" ? body.genre : undefined,
      synopsis: typeof body.synopsis === "string" ? body.synopsis : undefined,
      lorebook: typeof body.lorebook === "string" ? body.lorebook : undefined,
      specializedPrompt: typeof body.specializedPrompt === "boolean" ? body.specializedPrompt : undefined,
    });
    return NextResponse.json({ story }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "创建故事失败" }, { status: 400 });
  }
}