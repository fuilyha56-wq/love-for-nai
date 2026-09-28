import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getProvider } from "@/lib/provider/store";
import { discoverProviderModels } from "@/lib/provider/models";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("providerId") || "";
  const provider = await getProvider(session.userId, id);
  if (!provider) return NextResponse.json({ message: "找不到该第三方 API 配置" }, { status: 404 });
  let discovered: string[] = [];
  let warning: string | undefined;
  try { discovered = await discoverProviderModels(provider); }
  catch { warning = "无法读取远端模型，已显示手动导入的模型"; }
  const items = [...new Set([...provider.models, ...discovered])].sort((a,b) => a.localeCompare(b)).map((id) => ({ id, kind: "图像模型" }));
  return NextResponse.json({ items, ...(warning ? { warning } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
