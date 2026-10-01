import { NextResponse } from "next/server";
import { getImageToken, resolvedNewApiBaseUrl } from "@/lib/newapi";
import { resolvedAuthProviderId } from "@/lib/platform";
import { fetchWithModelConcurrency } from "@/lib/model-concurrency";
import { isImageProviderProtocol } from "@/lib/image-model-capabilities";
import { gatewayLogStart } from "@/lib/gateway-log";
import type { LfnSession } from "@/lib/session";
import { handleImageModelGeneration } from "./image-generation";
import { userCanGenerateWithNewApiModel } from "./newapi-models";
import { validateModelId } from "./validation";
import { checkImageRateLimit } from "@/lib/image-request";

/** Non-NAI models use the account's actual upstream protocol and never spend NAI AFF packages. */
export async function handleNewApiImageModelGeneration(request: Request, session: LfnSession, body: Record<string, unknown>, saveToHistory = true): Promise<NextResponse> {
  const rate = checkImageRateLimit(request, `session:${session.userId}`);
  if (!rate.allowed) return NextResponse.json({ message: "图像请求过于频繁，请稍后重试" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let model: string;
  try { model = validateModelId(body.model); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "模型 ID 无效" }, { status: 400 }); }
  if ((await resolvedAuthProviderId()) === "local") return NextResponse.json({ message: "本地账号请先在设置中添加图像模型的个人 API 来源" }, { status: 400 });
  if (body.imageProtocol !== undefined && !isImageProviderProtocol(body.imageProtocol)) return NextResponse.json({ message: "图像 API 协议无效" }, { status: 400 });
  try {
    if (!await userCanGenerateWithNewApiModel(session, model)) return NextResponse.json({ message: "当前模型不允许用于图像生成" }, { status: 400 });
    const key = await getImageToken(session, model);
    const baseUrl = await resolvedNewApiBaseUrl();
    return handleImageModelGeneration(request, session, { ...body, model }, {
      apiKey: key,
      protocol: isImageProviderProtocol(body.imageProtocol) ? body.imageProtocol : "auto",
      paymentSource: "newapi",
      rateChecked: true,
      saveToHistory,
      send: async (upstream) => {
        const finishLog = gatewayLogStart({ source: "lfn", user: session.username, endpoint: upstream.path, op: typeof body.operation === "string" ? body.operation : "generate", model, samples: 1 });
        try {
          const response = await fetchWithModelConcurrency(`${baseUrl}${upstream.path}`, { method: "POST", headers: upstream.headers, body: upstream.body, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]) });
          finishLog(response.status);
          return response;
        } catch (error) { finishLog(0); throw error; }
      },
    });
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "无法验证模型来源" }, { status: 502 }); }
}
