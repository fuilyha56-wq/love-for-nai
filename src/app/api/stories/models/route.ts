import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { resolvedNewApiBaseUrl } from "@/lib/newapi";
import { listStoryProviders } from "@/lib/story-providers";
import { loadNewApiModels } from "@/lib/provider/newapi-models";

// 故事页文本模型列表：实时读取上游 NewAPI 全量配置（/api/user/models +
// /api/pricing），排除图像模型，与「模型与密钥」页同源；不落文件凭证。
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "请先登录" }, { status: 401 });
  const providers = await listStoryProviders(session.userId);
  let newApi: Array<{ id: string; label: string; source: string }> = [];
  let warning: string | undefined;
  try {
    const [allModels, base] = await Promise.all([
      loadNewApiModels(session),
      resolvedNewApiBaseUrl(),
    ]);
    void base;
    // 只保留文本模型（排除 nai- 图像模型，保留 nai-chat 文本模型）。
    newApi = allModels
      .filter((item) => item.kind === "助手模型")
      .map((item) => ({ id: `newapi:${item.id}`, label: item.id, source: "NewAPI" }));
  } catch (error) { warning = error instanceof Error ? error.message : "无法读取 NewAPI 模型"; }
  return NextResponse.json({
    items: [...newApi, ...providers.map((item) => ({ id: `custom:${item.id}`, label: item.name, source: item.kind === "novelai" ? "NovelAI Key" : "自定义 API" }))],
    warning,
  });
}