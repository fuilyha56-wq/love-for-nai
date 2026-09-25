import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { deleteStoryProvider, listStoryProviders, saveStoryProvider } from "@/lib/story-providers";
import { validateStoryProviderUrl } from "@/lib/story-provider-network";
import { invalidJsonResponse, parseJsonBody } from "@/lib/request";

const unauthorized = () => NextResponse.json({ message: "请先登录" }, { status: 401 });

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  return NextResponse.json({ items: await listStoryProviders(session.userId) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  let body: Record<string, unknown>;
  try { body = await parseJsonBody(request); } catch (error) { return invalidJsonResponse(error); }
  try {
    if (body.kind !== "openai" && body.kind !== "novelai") throw new Error("模型源类型无效");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const key = typeof body.key === "string" ? body.key.trim() : "";
    const id = typeof body.id === "string" ? body.id : undefined;
    if (!name || name.length > 60 || !model || model.length > 120 || key.length > 1000 || id && !/^[0-9a-f-]{36}$/i.test(id))
      throw new Error("请检查名称、模型名与密钥长度");
    if (body.kind === "novelai" && model !== "llama-3-erato-v1" && model !== "kayra-v1")
      throw new Error("NovelAI 官方文本模型仅支持 Erato 或 Kayra");
    const baseUrl = body.kind === "novelai" ? "https://text.novelai.net" : await validateStoryProviderUrl(String(body.baseUrl || ""));
    const item = await saveStoryProvider(session.userId, { id, kind: body.kind, name, model, baseUrl, key });
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const id = new URL(request.url).searchParams.get("id") || "";
  return (await deleteStoryProvider(session.userId, id))
    ? NextResponse.json({ success: true })
    : NextResponse.json({ message: "模型源不存在" }, { status: 404 });
}