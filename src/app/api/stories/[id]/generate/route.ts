import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { applyStoryGeneration, generateStoryText, STORY_GENERATION_MODES } from "@/lib/story-generation";
import { findStory, updateStory } from "@/lib/stories";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

type Payload = {
  branchId?: unknown;
  mode?: unknown;
  instruction?: unknown;
  content?: unknown;
  selectionStart?: unknown;
  selectionEnd?: unknown;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录后生成正文" }, { status: 401 });
  let body: Payload;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return invalidJsonResponse(error);
  }
  if (typeof body.branchId !== "string") return NextResponse.json({ message: "缺少目标分支" }, { status: 400 });
  if (typeof body.content !== "string" || body.content.length > 2_000_000)
    return NextResponse.json({ message: "正文必须是 200 万字以内的字符串" }, { status: 400 });
  if (typeof body.mode !== "string" || !STORY_GENERATION_MODES.includes(body.mode as never))
    return NextResponse.json({ message: "生成模式只能是 continue、rewrite 或 insert" }, { status: 400 });
  if (body.instruction !== undefined && (typeof body.instruction !== "string" || body.instruction.length > 2_000))
    return NextResponse.json({ message: "生成指令不能超过 2000 字" }, { status: 400 });
  const selectionStart = Number(body.selectionStart ?? body.content.length);
  const selectionEnd = Number(body.selectionEnd ?? selectionStart);
  if (!Number.isFinite(selectionStart) || !Number.isFinite(selectionEnd))
    return NextResponse.json({ message: "选区位置必须是有效数字" }, { status: 400 });

  const story = await findStory(session.userId, (await params).id);
  if (!story) return NextResponse.json({ message: "故事不存在" }, { status: 404 });
  const branch = story.branches.find((item) => item.id === body.branchId);
  if (!branch) return NextResponse.json({ message: "目标分支不存在" }, { status: 404 });
  const input = {
    mode: body.mode as (typeof STORY_GENERATION_MODES)[number],
    instruction: typeof body.instruction === "string" ? body.instruction : "",
    content: body.content,
    selectionStart,
    selectionEnd,
  };
  try {
    const generated = await generateStoryText(session, story, branch, input);
    const content = applyStoryGeneration(input, generated);
    const saved = await updateStory(session.userId, story.id, {
      activeBranchId: branch.id,
      branch: { id: branch.id, content },
    });
    return NextResponse.json({ story: saved, generated, content });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "生成正文失败" },
      { status: 502 },
    );
  }
}