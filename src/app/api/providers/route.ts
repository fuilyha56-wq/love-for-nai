import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { addProvider, deleteProvider, listProviders } from "@/lib/provider/store";
import { ProviderInputError, validateApiKey, validateModels, validateProviderBaseUrl, validateProviderName } from "@/lib/provider/validation";

const unauthorized = () => NextResponse.json({ message: "请先登录" }, { status: 401 });

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  try { return NextResponse.json({ items: await listProviders(session.userId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ message: "无法读取第三方 API 配置" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  try {
    if (Number(request.headers.get("content-length") || 0) > 16_384) throw new ProviderInputError("请求过大");
    const body = await request.json() as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProviderInputError("请求格式无效");
    const item = await addProvider(session.userId, {
      name: validateProviderName(body.name),
      baseUrl: validateProviderBaseUrl(body.baseUrl),
      apiKey: validateApiKey(body.apiKey),
      models: validateModels(body.models),
    });
    return NextResponse.json({ item }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = error instanceof ProviderInputError || error instanceof RangeError || error instanceof SyntaxError;
    return NextResponse.json({ message: invalid && error instanceof Error ? error.message : "无法保存第三方 API 配置" }, { status: invalid ? 400 : 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ message: "配置 ID 无效" }, { status: 400 });
  try {
    if (!await deleteProvider(session.userId, id)) return NextResponse.json({ message: "找不到该配置" }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ message: "无法删除第三方 API 配置" }, { status: 500 }); }
}
