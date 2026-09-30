import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getNovelaiKey, setNovelaiKey } from "@/lib/provider/store";
import { NovelaiAuthError, readNovelaiAccount } from "@/lib/provider/novelai";
import { ProviderInputError, validateApiKey } from "@/lib/provider/validation";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  try {
    const key = await getNovelaiKey(session.userId);
    if (!key) return NextResponse.json({ account: null }, { headers: { "Cache-Control": "no-store" } });
    try { return NextResponse.json({ account: await readNovelaiAccount(key) }, { headers: { "Cache-Control": "no-store" } }); }
    catch (error) {
      if (error instanceof NovelaiAuthError)
        return NextResponse.json({ account: null, keySaved: true, error: error.message }, { headers: { "Cache-Control": "no-store" } });
      return NextResponse.json({ account: { connected: true, tier: null, active: null, anlas: null, usage: null, expiresAt: null }, error: error instanceof Error ? error.message : "无法读取 NovelAI 账号" }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch { return NextResponse.json({ message: "无法读取 NovelAI 账号配置" }, { status: 500 }); }
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  try {
    if (Number(request.headers.get("content-length") || 0) > 4096) throw new ProviderInputError("请求过大");
    const body = await request.json() as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProviderInputError("请求格式无效");
    const key = validateApiKey(body.key ?? body.apiKey);
    const account = await readNovelaiAccount(key);
    await setNovelaiKey(session.userId, key);
    return NextResponse.json({ account }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = error instanceof ProviderInputError || error instanceof SyntaxError;
    const message = error instanceof Error ? error.message : "无法连接 NovelAI";
    return NextResponse.json({ message: invalid || message.startsWith("NovelAI") ? message : "无法连接 NovelAI" }, { status: invalid ? 400 : message.includes("无效") ? 401 : 502 });
  }
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  try { await setNovelaiKey(session.userId, null); return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ message: "无法移除 NovelAI Key" }, { status: 500 }); }
}
